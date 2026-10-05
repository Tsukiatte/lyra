import { icons } from './icons.js';
import { settings } from './settings.js';
import { clamp, h } from './util.js';

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

// Split a line into words and spaces, flagging (backing vocals) in parentheses.
function tokenize(text) {
  const out = [];
  let depth = 0;
  for (const part of text.split(/(\s+)/)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      out.push({ space: true, text: part });
      continue;
    }
    const opens = (part.match(/[([]/g) || []).length;
    const closes = (part.match(/[)\]]/g) || []).length;
    const bv = depth > 0 || opens > 0;
    depth = Math.max(0, depth + opens - closes);
    if (CJK.test(part) && part.length > 1) for (const ch of part) out.push({ text: ch, bv });
    else out.push({ text: part, bv });
  }
  return out;
}

// Without word-level timing, estimate it: words are weighted by length and swept
// at a natural singing pace, never slower than the line itself.
function timeWords(words, start, end) {
  const dur = Math.max(300, end - start);
  const weights = words.map((w) => (w.text.replace(/[^\p{L}\p{N}]/gu, '').length || 1) + 1.4);
  const total = weights.reduce((a, b) => a + b, 0);
  const sweep = Math.min(dur - 80, Math.max(650, total * 62 + 250));
  let acc = 0;
  words.forEach((w, i) => {
    w.start = start + (sweep * acc) / total;
    acc += weights[i];
    w.end = start + (sweep * acc) / total;
  });
}

const MESSAGES = {
  none: [icons.lyrics, 'No lyrics for this one', 'Nothing synced yet. Enjoy the music.'],
  instrumental: [icons.music, 'Instrumental', 'No words, just the ride.'],
  episode: [icons.music, 'Podcast playing', 'Lyrics aren’t available for episodes.'],
  error: [icons.refresh, 'Couldn’t load lyrics', 'Check the connection and try again.'],
};

// After this long without a touch or scroll, the view glides back to the live line.
const IDLE_MS = 2000;

// Frame-rate independent easing factor: k is the fraction covered per 60 fps frame.
const ease = (k, dt) => 1 - Math.pow(1 - k, dt * 60);

export class LyricsView {
  constructor(root, { onSeek } = {}) {
    this.root = root;
    this.onSeek = onSeek;
    this.inner = h('div', { class: 'ly-inner' });
    this.note = h('div', { class: 'ly-note' });
    root.append(this.inner, this.note);
    this.items = [];
    this.active = -1;
    this.base = 0;
    this.lastBase = null;
    this.plainFrac = 0;
    // Manual scrolling rides on top of the live position: wheel input glides, drags
    // carry momentum, both rubber-band at the ends, then it drifts back to the live line.
    this.offset = 0;
    this.glideTo = null;
    this.velocity = 0;
    this.dragging = false;
    this.browsing = false;
    this.userUntil = 0;
    this.lastStep = 0;
    this.setMode('empty');
    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(root);
    this.bindGestures();
  }

  destroy() {
    this.ro.disconnect();
  }

  setMode(mode) {
    this.mode = mode;
    this.root.dataset.mode = mode;
  }

  clear() {
    this.items = [];
    this.inner.textContent = '';
    this.note.textContent = '';
    this.active = -1;
    this.lastBase = null;
    this.offset = 0;
    this.glideTo = null;
    this.velocity = 0;
    this.dragging = false;
    this.setBrowsing(false);
    this.applyOffset();
  }

  loading() {
    this.clear();
    this.setMode('loading');
    for (const w of [74, 56, 66]) this.inner.append(h('div', { class: 'ly-skel', style: `width:${w}%` }));
  }

  message(kind, { retry } = {}) {
    this.clear();
    this.setMode('message');
    const [icon, title, sub] = MESSAGES[kind] || MESSAGES.none;
    this.note.append(h('div', { class: 'ly-note-icon', html: icon }), h('div', { class: 'ly-note-title' }, title), h('div', { class: 'ly-note-sub' }, sub));
    if (retry) this.note.append(h('button', { class: 'btn btn-glass btn-sm', onclick: retry }, 'Try again'));
  }

  set(result) {
    if (!result || result.kind === 'none') return this.message('none');
    if (result.kind === 'instrumental') return this.message('instrumental');
    this.clear();
    if (result.kind === 'plain') {
      this.setMode('plain');
      for (const line of result.lines) this.inner.append(line.text ? h('div', { class: 'ly-line is-plain' }, line.text) : h('div', { class: 'ly-space' }));
    } else {
      this.setMode('synced');
      this.buildSynced(result.lines);
    }
    this.inner.append(h('div', { class: 'ly-credit' }, result.kind === 'plain' ? 'Unsynced lyrics · LRCLIB' : 'Lyrics · LRCLIB'));
    this.active = -2;
    this.measure();
  }

  buildSynced(lines) {
    for (const line of lines) {
      if (line.gap) {
        const dots = h('div', { class: 'ly-dots' }, h('div', { class: 'ly-dots-in' }, h('i', { style: '--n:0' }), h('i', { style: '--n:1' }), h('i', { style: '--n:2' })));
        const el = h('div', { class: 'ly-gap' }, dots);
        this.items.push({ kind: 'gap', el, start: line.start, end: line.end });
        this.inner.append(el);
        continue;
      }
      const el = h('div', { class: 'ly-line' });
      const words = [];
      if (line.words) {
        for (const w of line.words) {
          const [, pre, core, post] = w.text.match(/^(\s*)([\s\S]*?)(\s*)$/);
          if (pre) el.append(pre);
          if (core) {
            const span = h('span', { class: 'w' }, core);
            el.append(span);
            words.push({ el: span, start: w.start, end: w.end });
          }
          if (post) el.append(post);
        }
        words.forEach((w, i) => {
          if (!(w.end > w.start)) w.end = words[i + 1]?.start ?? line.end;
        });
      } else {
        const tokens = tokenize(line.text);
        for (const t of tokens) {
          if (t.space) {
            el.append(t.text);
            continue;
          }
          const span = h('span', { class: t.bv ? 'w bv' : 'w' }, t.text);
          el.append(span);
          words.push({ el: span, text: t.text });
        }
        timeWords(words, line.start, line.end);
        if (tokens.every((t) => t.space || t.bv)) el.classList.add('is-bv');
      }
      this.items.push({ kind: 'line', el, start: line.start, end: line.end, words });
      this.inner.append(el);
    }
  }

  readAnchor() {
    this.anchor = parseFloat(getComputedStyle(this.root).getPropertyValue('--anchor')) || 0.38;
  }

  measure() {
    this.viewH = this.root.clientHeight;
    this.readAnchor();
    this.contentH = this.inner.scrollHeight;
    if (this.mode === 'synced') {
      this.tops = this.items.map((it) => it.el.offsetTop);
      this.heights = this.items.map((it) => it.el.offsetHeight);
      this.layout(true);
    }
    this.applyOffset();
  }

  // Re-read --anchor (e.g. on entering immersive mode) and glide the lines to it.
  reanchor() {
    this.readAnchor();
    this.layout();
  }

  indexAt(t) {
    let lo = 0;
    let hi = this.items.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.items[mid].start <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  // Called every animation frame with the lyric clock (ms) and song progress (0–1).
  update(t, now, frac) {
    if (this.mode === 'synced') {
      const i = this.indexAt(t);
      if (i !== this.active) this.setActive(i);
      const it = this.items[i];
      if (it?.kind === 'line') {
        if (settings.values.wordSweep) this.paintWords(it, t);
      } else if (it?.kind === 'gap') {
        this.paintGap(it, t);
      }
    } else if (this.mode === 'plain' && Math.abs(frac - this.plainFrac) > 0.0004) {
      this.plainFrac = frac;
      this.dirty = true;
    }
    this.stepScroll(now);
  }

  // What's being sung right now, for the visualizer: an instrumental gap, or the
  // current line and the latest word to start.
  vocalAt(t) {
    if (this.mode !== 'synced') return null;
    const it = this.items[this.active];
    if (!it) return null;
    if (it.kind === 'gap') return { gap: true };
    let wordStart = it.start;
    for (const w of it.words) {
      if (w.start > t) break;
      wordStart = w.start;
    }
    return { lineStart: it.start, wordStart };
  }

  setActive(i) {
    this.active = i;
    for (let j = 0; j < this.items.length; j++) {
      const { el } = this.items[j];
      const d = j - i;
      el.classList.toggle('is-active', d === 0);
      el.classList.toggle('is-past', d < 0);
      el.classList.toggle('is-next', d === 1);
      el.classList.toggle('is-far', d < -7 || d > 12);
      el.style.setProperty('--d', String(Math.min(Math.abs(d), 6)));
    }
    this.layout();
  }

  // Positions every line so the active one sits at the anchor (with a cascade).
  layout(instant = false) {
    if (this.mode !== 'synced' || !this.items.length || !this.tops) return;
    const i = clamp(this.active, 0, this.items.length - 1);
    const base = this.viewH * this.anchor - (this.tops[i] + this.heights[i] / 2);
    if (this.browsing && this.lastBase != null) {
      // While browsing, the text stays where the finger left it even as the song moves on.
      const shift = base - this.lastBase;
      this.offset -= shift;
      if (this.glideTo != null) this.glideTo -= shift;
      instant = true;
    }
    this.base = base;
    this.lastBase = base;
    const y = Math.round(base);
    const cascade = !instant && settings.values.cascade && !settings.values.lowPower;
    if (instant) this.root.classList.add('is-instant');
    for (let j = 0; j < this.items.length; j++) {
      const { el } = this.items[j];
      const d = j - i;
      el.style.transitionDelay = cascade && d >= 0 ? `${Math.min(d, 9) * 42}ms` : '0ms';
      el.style.setProperty('--y', `${y}px`);
    }
    if (instant) {
      void this.root.offsetWidth;
      this.root.classList.remove('is-instant');
    }
    this.applyOffset();
  }

  plainAuto() {
    const max = Math.max(0, this.contentH - this.viewH * 0.55);
    return settings.values.autoScrollPlain ? -this.plainFrac * max : 0;
  }

  // How far manual scrolling may go before it rubber-bands.
  bounds() {
    if (this.mode === 'synced') {
      return [Math.min(0, this.viewH * 0.5 - this.contentH - this.base), Math.max(0, this.viewH * 0.5 - this.base)];
    }
    if (this.mode === 'plain') {
      const max = Math.max(0, this.contentH - this.viewH * 0.55);
      const auto = this.plainAuto();
      return [Math.min(0, -max - auto), Math.max(0, -auto)];
    }
    return [0, 0];
  }

  applyOffset() {
    let y = this.offset;
    if (this.mode === 'plain') y += this.plainAuto() + this.viewH * 0.1;
    this.inner.style.transform = Math.abs(y) > 0.05 ? `translate3d(0, ${y.toFixed(2)}px, 0)` : '';
  }

  setBrowsing(on) {
    if (this.browsing === on) return;
    this.browsing = on;
    this.root.classList.toggle('is-browsing', on);
  }

  stepScroll(now) {
    const dt = this.lastStep ? Math.min(0.05, (now - this.lastStep) / 1000) : 1 / 60;
    this.lastStep = now;
    if (this.mode !== 'synced' && this.mode !== 'plain') return;
    const [lo, hi] = this.bounds();
    const before = this.offset;
    if (this.dragging) {
      // The pointer drives the offset directly.
    } else if (this.glideTo != null) {
      if (this.glideTo < lo) this.glideTo += (lo - this.glideTo) * ease(0.18, dt);
      else if (this.glideTo > hi) this.glideTo += (hi - this.glideTo) * ease(0.18, dt);
      this.offset += (this.glideTo - this.offset) * ease(0.085, dt);
      if (Math.abs(this.glideTo - this.offset) < 0.3 && this.glideTo >= lo - 0.5 && this.glideTo <= hi + 0.5) {
        this.offset = clamp(this.glideTo, lo, hi);
        this.glideTo = null;
      }
    } else if (Math.abs(this.velocity) > 15) {
      this.offset += this.velocity * dt;
      const out = this.offset < lo || this.offset > hi;
      this.velocity *= Math.pow(out ? 0.72 : 0.955, dt * 60);
    } else {
      this.velocity = 0;
      if (this.offset < lo - 0.3 || this.offset > hi + 0.3) {
        this.offset += ((this.offset < lo ? lo : hi) - this.offset) * ease(0.16, dt);
      } else if (this.offset !== 0 && now > this.userUntil) {
        this.offset += -this.offset * ease(0.065, dt);
        if (Math.abs(this.offset) < 0.4) this.offset = 0;
      }
      if (this.offset === 0 && now > this.userUntil) this.setBrowsing(false);
    }
    if (this.offset !== before || this.dirty) {
      this.dirty = false;
      this.applyOffset();
    }
  }

  paintWords(it, t) {
    for (const w of it.words) {
      const p = t <= w.start ? 0 : t >= w.end ? 1 : (t - w.start) / (w.end - w.start);
      if (Math.abs(p - (w.p ?? -1)) > 0.004) {
        w.p = p;
        w.el.style.setProperty('--p', p.toFixed(3));
      }
    }
  }

  paintGap(it, t) {
    const g = clamp((t - it.start) / Math.max(1, it.end - it.start), 0, 1);
    if (Math.abs(g - (it.g ?? -1)) > 0.003) {
      it.g = g;
      it.el.style.setProperty('--g', g.toFixed(3));
    }
  }

  bindGestures() {
    const root = this.root;
    const scrollable = () => this.mode === 'synced' || this.mode === 'plain';
    const samples = [];
    let pid = null;
    let startY = 0;
    let startOffset = 0;
    let moved = false;

    const begin = (e) => {
      pid = e.pointerId;
      startY = e.clientY;
      startOffset = this.offset;
      moved = false;
      samples.length = 0;
      // A press catches a fling mid-flight, like on a phone.
      this.velocity = 0;
      this.glideTo = null;
    };
    root.addEventListener('pointerdown', (e) => {
      if (e.button === 0) begin(e);
    });
    // Lets a press that started elsewhere (anywhere on screen in immersive mode) scroll the lyrics.
    this.adoptPress = (e) => {
      if (e.button > 0 || !scrollable()) return;
      begin(e);
      try {
        root.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone */
      }
    };
    root.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid || !scrollable()) return;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dy) > 8) {
        moved = true;
        this.dragging = true;
        this.setBrowsing(true);
        root.classList.add('is-dragging');
        try {
          root.setPointerCapture(pid);
        } catch {
          /* pointer already gone */
        }
      }
      if (!moved) return;
      const [lo, hi] = this.bounds();
      let next = startOffset + dy;
      if (next > hi) next = hi + (next - hi) * 0.38;
      else if (next < lo) next = lo + (next - lo) * 0.38;
      this.offset = next;
      this.userUntil = performance.now() + IDLE_MS;
      const t = performance.now();
      samples.push([t, next]);
      while (samples.length > 2 && t - samples[0][0] > 90) samples.shift();
      this.applyOffset();
    });
    const finish = (e, cancelled) => {
      if (e.pointerId !== pid) return;
      pid = null;
      if (moved) {
        this.dragging = false;
        root.classList.remove('is-dragging');
        const [t0, y0] = samples[0] || [0, 0];
        const [t1, y1] = samples[samples.length - 1] || [0, 0];
        // Only fling if the finger was still moving when it lifted (not after a pause).
        const fresh = performance.now() - t1 < 80;
        this.velocity = fresh && t1 > t0 ? clamp(((y1 - y0) / (t1 - t0)) * 1000, -6000, 6000) : 0;
        this.userUntil = performance.now() + IDLE_MS;
      } else if (!cancelled && !e.defaultPrevented) {
        this.tap(e.target);
      }
    };
    root.addEventListener('pointerup', (e) => finish(e, false));
    root.addEventListener('pointercancel', (e) => finish(e, true));
    root.addEventListener('wheel', (e) => {
      if (!scrollable() || e.ctrlKey) return;
      e.preventDefault();
      const [lo, hi] = this.bounds();
      if (this.glideTo == null) this.glideTo = this.offset;
      this.velocity = 0;
      this.glideTo = clamp(this.glideTo - e.deltaY * (e.deltaMode === 1 ? 32 : 1), lo - 160, hi + 160);
      this.setBrowsing(true);
      this.userUntil = performance.now() + IDLE_MS;
    }, { passive: false });
  }

  tap(target) {
    if (this.mode !== 'synced' || !settings.values.tapToSeek) return;
    const el = target.closest?.('.ly-line, .ly-gap');
    const item = el && this.items.find((it) => it.el === el);
    if (!item) return;
    el.classList.remove('is-tapped');
    void el.offsetWidth;
    el.classList.add('is-tapped');
    // Hand the view back to the live position; the tapped line glides into place.
    this.velocity = 0;
    this.glideTo = null;
    this.userUntil = 0;
    this.setBrowsing(false);
    this.onSeek?.(item.start);
  }
}
