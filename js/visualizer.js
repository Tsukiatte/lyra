// Audio visualizer. Browsers can't tap Spotify's audio, so by default the spectrum is
// synthesized from what's being sung (word and line onsets from the synced lyrics),
// which makes it pulse with the vocals. With "Microphone" it analyzes real sound in
// the room instead (where the browser allows mic access).

import { settings } from './settings.js';
import { clamp } from './util.js';

const BANDS = 48;
const TAU = Math.PI * 2;

// Smooth, non-repeating motion per band from a few incommensurate sines (0..1).
function wobble(t, i) {
  const a = Math.sin(t * (1.31 + i * 0.071) + i * 1.7);
  const b = Math.sin(t * (2.07 + i * 0.053) + i * 0.9) * 0.6;
  const c = Math.sin(t * (0.73 + i * 0.113) + i * 2.3) * 0.4;
  return (a + b + c) / 4 + 0.5;
}

// Point + outward normal at distance s along a rounded square's outline, clockwise
// from top center. a = half the straight edge length, r = corner radius.
function perimeter(s, a, r) {
  const q = (Math.PI * r) / 2;
  const segs = [a, q, 2 * a, q, 2 * a, q, 2 * a, q, a];
  let i = 0;
  while (i < segs.length - 1 && s > segs[i]) {
    s -= segs[i];
    i++;
  }
  const R = a + r;
  const arc = (cx, cy, from) => {
    const th = from + (r ? s / r : 0);
    return { x: cx + r * Math.cos(th), y: cy + r * Math.sin(th), nx: Math.cos(th), ny: Math.sin(th) };
  };
  switch (i) {
    case 0: return { x: s, y: -R, nx: 0, ny: -1 };
    case 1: return arc(a, -a, -Math.PI / 2);
    case 2: return { x: R, y: -a + s, nx: 1, ny: 0 };
    case 3: return arc(a, a, 0);
    case 4: return { x: a - s, y: R, nx: 0, ny: 1 };
    case 5: return arc(-a, a, Math.PI / 2);
    case 6: return { x: -R, y: a - s, nx: -1, ny: 0 };
    case 7: return arc(-a, -a, Math.PI);
    default: return { x: -a + s, y: -R, nx: 0, ny: -1 };
  }
}

function roundTop(g, x, y, w, h, r) {
  g.moveTo(x, y + h);
  g.lineTo(x, y + r);
  g.arcTo(x, y, x + r, y, r);
  g.lineTo(x + w - r, y);
  g.arcTo(x + w, y, x + w, y + r, r);
  g.lineTo(x + w, y + h);
  g.closePath();
}

export class Visualizer {
  constructor({ root, artWrap, art, onNotice }) {
    this.art = art;
    this.onNotice = onNotice;
    this.levels = new Float32Array(BANDS);
    this.target = new Float32Array(BANDS);
    this.energy = 0;
    this.last = 0;
    this.cache = { at: -1e9 };
    this.halo = document.createElement('canvas');
    this.halo.className = 'viz viz-halo';
    this.strip = document.createElement('canvas');
    this.strip.className = 'viz viz-strip';
    artWrap.prepend(this.halo);
    root.prepend(this.strip);
    this.drawn = { halo: false, strip: false };
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.halo);
    this.ro.observe(this.strip);
    this.offSource = settings.on('vizSource', (v) => this.useSource(v));
    this.useSource(settings.get('vizSource'));
  }

  destroy() {
    this.ro.disconnect();
    this.offSource();
    this.stopMic();
    this.halo.remove();
    this.strip.remove();
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    for (const c of [this.halo, this.strip]) {
      const w = Math.round(c.clientWidth * dpr);
      const ht = Math.round(c.clientHeight * dpr);
      if (w && ht && (c.width !== w || c.height !== ht)) {
        c.width = w;
        c.height = ht;
      }
    }
    this.cache.at = -1e9;
  }

  // ── Sources ───────────────────────────────────────────────────────────────

  async useSource(kind) {
    if (kind !== 'mic') return this.stopMic();
    if (this.mic || this.connecting) return;
    this.connecting = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (settings.get('vizSource') !== 'mic') {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.72;
      ctx.createMediaStreamSource(stream).connect(analyser);
      if (ctx.state === 'suspended') addEventListener('pointerdown', () => ctx.resume(), { once: true });
      this.mic = { stream, ctx, analyser, data: new Uint8Array(analyser.frequencyBinCount), peak: 0.2 };
      this.onNotice?.('Visualizer is listening (audio stays on this device)');
    } catch {
      this.onNotice?.('Microphone isn’t available here, so it follows the lyrics');
      settings.set('vizSource', 'sync');
    } finally {
      this.connecting = false;
    }
  }

  stopMic() {
    if (!this.mic) return;
    this.mic.stream.getTracks().forEach((t) => t.stop());
    this.mic.ctx.close().catch(() => {});
    this.mic = null;
  }

  // vocal: { gap } or { lineStart, wordStart } from the lyrics view, t: lyric clock (ms).
  synthesize(now, playing, vocal, t) {
    const sec = now / 1000;
    let word = 0;
    let phrase = 0;
    let inst = 0.3;
    if (vocal?.gap) inst = 0.6;
    else if (vocal) {
      word = Math.exp(-Math.max(0, t - vocal.wordStart) / 170);
      phrase = Math.exp(-Math.max(0, t - vocal.lineStart) / 450);
    }
    const drive = playing ? 0.3 + 0.3 * word + 0.25 * phrase + 0.25 * inst : 0;
    for (let i = 0; i < BANDS; i++) {
      const tilt = 1 - (i / BANDS) * 0.6;
      let v = wobble(sec * (1.5 + (i % 7) * 0.08), i) * tilt * drive;
      if (i > 7 && i < 30) v += word * 0.32 * (1 - Math.abs(i - 18) / 12);
      if (i < 6) v += phrase * 0.4 * (1 - i / 6);
      this.target[i] = clamp(v, 0, 1);
    }
  }

  readMic() {
    const { analyser, data, ctx } = this.mic;
    analyser.getByteFrequencyData(data);
    const binHz = ctx.sampleRate / 2 / data.length;
    let peak = 0;
    for (let i = 0; i < BANDS; i++) {
      const f0 = 40 * Math.pow(400, i / BANDS);
      const f1 = 40 * Math.pow(400, (i + 1) / BANDS);
      const b0 = Math.min(data.length - 1, Math.floor(f0 / binHz));
      const b1 = Math.min(data.length, Math.max(b0 + 1, Math.floor(f1 / binHz)));
      let sum = 0;
      for (let b = b0; b < b1; b++) sum += data[b];
      this.target[i] = sum / (b1 - b0) / 255;
      peak = Math.max(peak, this.target[i]);
    }
    // Auto-gain so quiet cabins still move the bars.
    this.mic.peak = Math.max(peak, this.mic.peak * 0.996, 0.08);
    for (let i = 0; i < BANDS; i++) this.target[i] = clamp((this.target[i] / this.mic.peak) * 0.95, 0, 1);
  }

  // ── Per frame ─────────────────────────────────────────────────────────────

  frame(now, { playing, vocal, t }) {
    const dt = this.last ? Math.min(100, now - this.last) : 16.7;
    this.last = now;
    const style = settings.values.visualizer;
    const visible = style !== 'off' && !settings.values.lowPower;
    if (this.mic) this.readMic();
    else this.synthesize(now, playing, vocal, t);
    const up = 1 - Math.pow(0.5, dt / 16.7);
    const down = 1 - Math.pow(0.9, dt / 16.7);
    let sum = 0;
    for (let i = 0; i < BANDS; i++) {
      const cur = this.levels[i];
      const tgt = this.target[i];
      this.levels[i] = cur + (tgt - cur) * (tgt > cur ? up : down);
      sum += this.levels[i] * (i < 12 ? 1.6 : 0.6);
    }
    this.energy = clamp(sum / (12 * 1.6 + 36 * 0.6), 0, 1);
    if (visible) this.draw(style, now);
    else this.clearAll();
    return this.energy;
  }

  refreshCache(now) {
    if (now - this.cache.at < 500) return this.cache;
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent-rgb').split(',').map((v) => parseInt(v, 10));
    const radius = getComputedStyle(this.art).borderTopLeftRadius;
    const size = this.art.clientWidth;
    this.cache = {
      at: now,
      rgb: accent.length === 3 && accent.every(Number.isFinite) ? accent.join(',') : '255,255,255',
      artSize: size,
      artRadius: radius.endsWith('%') ? (parseFloat(radius) / 100) * size : parseFloat(radius) || 0,
    };
    return this.cache;
  }

  draw(style, now) {
    const cache = this.refreshCache(now);
    const haloShown = style === 'halo' && this.halo.offsetParent !== null && this.halo.width > 0 && cache.artSize > 0;
    if (haloShown) this.drawHalo(cache);
    else this.clear('halo');
    const strip = style === 'wave' ? 'wave' : style === 'bars' || (style === 'halo' && !haloShown) ? 'bars' : null;
    if (strip && this.strip.offsetParent !== null && this.strip.width > 0) {
      if (strip === 'wave') this.drawWave(cache, now);
      else this.drawBars(cache);
    } else {
      this.clear('strip');
    }
  }

  clear(which) {
    if (!this.drawn[which]) return;
    const c = this[which];
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    this.drawn[which] = false;
  }

  clearAll() {
    this.clear('halo');
    this.clear('strip');
  }

  // Bars that hug the artwork's outline (square, rounded or round).
  drawHalo({ rgb, artSize, artRadius }) {
    const c = this.halo;
    const g = c.getContext('2d');
    const W = c.width;
    const H = c.height;
    const k = W / c.clientWidth;
    const art = artSize * k;
    const half = art / 2;
    const r = Math.min(half, artRadius * k);
    const a = half - r;
    const per = 8 * a + TAU * r;
    const N = 132;
    const gap = art * 0.045;
    const maxLen = Math.max(4, (W - art) / 2 - gap - 2 * k);
    const path = new Path2D();
    for (let i = 0; i < N; i++) {
      const p = perimeter((i / N) * per, a, r);
      // Bass on the left and right edges (where there's room), treble toward top and bottom.
      const band = Math.min(BANDS - 1, Math.floor((Math.atan2(Math.abs(p.y), Math.abs(p.x)) / (Math.PI / 2)) * (BANDS - 1)));
      const len = 2 * k + this.levels[band] * maxLen;
      const x0 = W / 2 + p.x + p.nx * gap;
      const y0 = H / 2 + p.y + p.ny * gap;
      path.moveTo(x0, y0);
      path.lineTo(x0 + p.nx * len, y0 + p.ny * len);
    }
    const lw = Math.max(1.5 * k, (per / N) * 0.42);
    g.clearRect(0, 0, W, H);
    g.lineCap = 'round';
    g.strokeStyle = `rgba(${rgb},0.16)`;
    g.lineWidth = lw * 2.6;
    g.stroke(path);
    g.strokeStyle = `rgba(${rgb},0.92)`;
    g.lineWidth = lw;
    g.stroke(path);
    this.drawn.halo = true;
  }

  // A mirrored spectrum along the bottom edge.
  drawBars({ rgb }) {
    const c = this.strip;
    const g = c.getContext('2d');
    const W = c.width;
    const H = c.height;
    const n = 72;
    const slot = W / n;
    const bw = slot * 0.56;
    const grad = g.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, `rgba(${rgb},0.6)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.clearRect(0, 0, W, H);
    g.fillStyle = grad;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const d = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
      const v = this.levels[Math.min(BANDS - 1, Math.floor(d * (BANDS - 1)))];
      const bh = Math.max(2, (0.05 + v * 0.95) * H * 0.92);
      roundTop(g, i * slot + (slot - bw) / 2, H - bh, bw, bh, bw / 2);
    }
    g.fill();
    this.drawn.strip = true;
  }

  // Three layered, tapered waves driven by the low, mid and high bands.
  drawWave({ rgb }, now) {
    const c = this.strip;
    const g = c.getContext('2d');
    const W = c.width;
    const H = c.height;
    const k = W / c.clientWidth;
    const t = now / 1000;
    const avg = (from, to) => {
      let s = 0;
      for (let i = from; i < to; i++) s += this.levels[i];
      return s / (to - from);
    };
    const layers = [
      { amp: avg(0, 12), freq: 1.6, speed: 1.1, alpha: 0.9, width: 3 },
      { amp: avg(12, 30), freq: 2.7, speed: -1.7, alpha: 0.55, width: 2 },
      { amp: avg(30, BANDS), freq: 4.1, speed: 2.4, alpha: 0.35, width: 1.5 },
    ];
    const base = H * 0.6;
    g.clearRect(0, 0, W, H);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const L of layers) {
      g.beginPath();
      for (let x = 0; x <= W; x += 6) {
        const u = x / W;
        const env = Math.sin(Math.PI * u) ** 2;
        const y = base - Math.sin(u * L.freq * TAU + t * L.speed) * env * (0.1 + L.amp * 1.4) * H * 0.42;
        if (x === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = `rgba(${rgb},${L.alpha * 0.22})`;
      g.lineWidth = L.width * 4 * k;
      g.stroke();
      g.strokeStyle = `rgba(${rgb},${L.alpha})`;
      g.lineWidth = L.width * k;
      g.stroke();
    }
    this.drawn.strip = true;
  }
}
