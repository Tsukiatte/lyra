// Demo mode: two original songs (lyrics written for Lyra) with generated cover art,
// played on a local clock. Lets you try every feature without connecting Spotify.

import { buildResult } from './lyrics.js';
import { clamp, Emitter } from './util.js';

const AFTERGLOW = `[00:07.80] City lights are melting into gold
[00:12.10] Every sign we pass is something we were told
[00:16.60] Hands up on the wheel, the night is open wide
[00:21.20] Nothing in the mirror, only you beside
[00:25.90] (Only you beside)
[00:28.40] So turn it up, the road is ours tonight
[00:33.00] We're chasing every afterglow in sight
[00:37.70] Windows down and nothing left to hide
[00:42.20] Hold on, hold on, enjoy the ride
[00:47.50] ♪
[00:58.80] Streetlamps flicker like a heartbeat slow
[01:03.20] Telling us the places only dreamers go
[01:07.80] Radio is singing what we never said
[01:12.30] Silver on the skyline, silver in your head
[01:17.00] (Silver in your head)
[01:19.60] So turn it up, the road is ours tonight
[01:24.20] We're chasing every afterglow in sight
[01:28.80] Windows down and nothing left to hide
[01:33.30] Hold on, hold on, enjoy the ride
[01:38.20] ♪
[01:46.00] And if the morning finds us far from home
[01:50.60] At least we'll know we never drove alone
[01:55.20] Oh, the city fades but we still shine
[01:59.90] Afterglow, afterglow, keep us in time
[02:05.00] Hold on, hold on
[02:09.40] Enjoy the ride
[02:14.00] ♪`;

const PAPER_MOONS = `[00:05.20] I folded you a paper moon
[00:09.40] And hung it where the window used to be
[00:14.00] It doesn't glow, it doesn't move
[00:18.30] But it's enough to light the way for me
[00:23.10] (Light the way for me)
[00:26.00] We were never made of stone
[00:30.20] Just paper, ink and borrowed time
[00:34.70] Let the quiet carry us home
[00:39.10] Every line a little less unkind
[00:44.20] ♪
[00:53.50] Tell me something soft and true
[00:57.80] The kind of thing that only rooftops hear
[01:02.40] I'll keep a paper moon for you
[01:06.80] In case the real one isn't here
[01:11.50] We were never made of stone
[01:15.70] Just paper, ink and borrowed time
[01:20.20] Let the quiet carry us home
[01:24.60] Every line a little less unkind
[01:30.00] ♪
[01:38.40] Ooh, paper moons
[01:42.80] Ooh, paper moons
[01:47.30] Hanging in the blue
[01:51.60] Hanging on to you
[01:57.00] ♪`;

function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size = 640) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function label(g, text, x, y) {
  g.font = '600 20px Geist, system-ui, sans-serif';
  if ('letterSpacing' in g) g.letterSpacing = '6px';
  g.fillStyle = 'rgba(255,255,255,.86)';
  g.fillText(text, x, y);
}

function coverAfterglow() {
  const [c, g] = canvas();
  const rand = seeded(7);
  const sky = g.createLinearGradient(0, 0, 0, 640);
  sky.addColorStop(0, '#0a0d2c');
  sky.addColorStop(0.42, '#3a1863');
  sky.addColorStop(0.7, '#b33a72');
  sky.addColorStop(1, '#ff9a62');
  g.fillStyle = sky;
  g.fillRect(0, 0, 640, 640);
  for (let i = 0; i < 80; i++) {
    g.fillStyle = `rgba(255,255,255,${0.2 + rand() * 0.6})`;
    const s = rand() < 0.15 ? 2.2 : 1.3;
    g.fillRect(rand() * 640, rand() * 300, s, s);
  }
  // Striped sun, drawn separately so the stripes cut the sun and not the sky.
  const [sunC, sg] = canvas();
  const sun = sg.createLinearGradient(0, 210, 0, 470);
  sun.addColorStop(0, '#ffe7a3');
  sun.addColorStop(1, '#ff4f7b');
  sg.fillStyle = sun;
  sg.beginPath();
  sg.arc(320, 360, 152, 0, Math.PI * 2);
  sg.fill();
  sg.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 7; i++) sg.fillRect(150, 376 + i * 17, 340, 3 + i * 1.7);
  const glow = g.createRadialGradient(320, 400, 20, 320, 400, 340);
  glow.addColorStop(0, 'rgba(255,150,120,.55)');
  glow.addColorStop(1, 'rgba(255,150,120,0)');
  g.fillStyle = glow;
  g.fillRect(0, 120, 640, 520);
  g.drawImage(sunC, 0, 0);
  // Horizon grid.
  g.fillStyle = '#140a26';
  g.fillRect(0, 470, 640, 170);
  g.strokeStyle = 'rgba(255,110,190,.55)';
  g.lineWidth = 1.6;
  for (let i = 0; i < 9; i++) {
    const y = 470 + Math.pow(i / 8, 2) * 170;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(640, y);
    g.stroke();
  }
  for (let i = -10; i <= 10; i++) {
    g.beginPath();
    g.moveTo(320 + i * 16, 470);
    g.lineTo(320 + i * 96, 640);
    g.stroke();
  }
  label(g, 'NOVA LANE', 40, 62);
  return c.toDataURL('image/jpeg', 0.92);
}

function coverPaperMoons() {
  const [c, g] = canvas();
  const rand = seeded(42);
  const sky = g.createLinearGradient(0, 0, 640, 640);
  sky.addColorStop(0, '#08141f');
  sky.addColorStop(0.55, '#14394a');
  sky.addColorStop(1, '#2c6b67');
  g.fillStyle = sky;
  g.fillRect(0, 0, 640, 640);
  for (let i = 0; i < 60; i++) {
    g.fillStyle = `rgba(255,240,210,${0.15 + rand() * 0.55})`;
    g.beginPath();
    g.arc(rand() * 640, rand() * 640, rand() * 1.4 + 0.4, 0, Math.PI * 2);
    g.fill();
  }
  // The string the paper moon hangs from.
  g.strokeStyle = 'rgba(255,240,210,.55)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(388, 0);
  g.lineTo(388, 128);
  g.stroke();
  const cx = 388;
  const cy = 268;
  const r = 140;
  const halo = g.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 2.2);
  halo.addColorStop(0, 'rgba(255,214,150,.35)');
  halo.addColorStop(1, 'rgba(255,214,150,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, 640, 640);
  // Faceted, folded-paper moon.
  const shades = ['#fff4d8', '#f1dfb2', '#fbeac2', '#e6cf98', '#fff0cc', '#ecd8a6'];
  const facets = 12;
  const pivot = [cx - 24, cy - 18];
  for (let i = 0; i < facets; i++) {
    const a0 = (i / facets) * Math.PI * 2;
    const a1 = ((i + 1) / facets) * Math.PI * 2;
    g.fillStyle = shades[i % shades.length];
    g.beginPath();
    g.moveTo(pivot[0], pivot[1]);
    g.lineTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
    g.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
    g.closePath();
    g.fill();
  }
  // Crescent shadow.
  g.fillStyle = 'rgba(10,30,42,.78)';
  g.beginPath();
  g.arc(cx + 64, cy - 30, r * 0.92, 0, Math.PI * 2);
  g.fill();
  label(g, 'THE QUIET HOURS', 40, 594);
  return c.toDataURL('image/jpeg', 0.92);
}

const TRACKS = [
  { id: 'demo-afterglow', title: 'Afterglow Drive', artists: ['Nova Lane'], album: 'Night Signals', durationMs: 144000, lrc: AFTERGLOW, cover: coverAfterglow },
  { id: 'demo-paper-moons', title: 'Paper Moons', artists: ['The Quiet Hours'], album: 'Soft Machines', durationMs: 132000, lrc: PAPER_MOONS, cover: coverPaperMoons },
];

export class DemoSource extends Emitter {
  constructor() {
    super();
    this.demo = true;
    this.index = 0;
    this.base = 0;
    this.at = performance.now();
    this.playing = true;
    this.shuffle = false;
    this.repeat = 'off';
    this.covers = new Map();
    this.state = null;
  }

  cover(t) {
    if (!this.covers.has(t.id)) this.covers.set(t.id, t.cover());
    return this.covers.get(t.id);
  }

  info(t) {
    return { kind: 'track', id: t.id, uri: `demo:${t.id}`, title: t.title, artists: t.artists, album: t.album, art: this.cover(t), durationMs: t.durationMs, demo: true };
  }

  get track() {
    return TRACKS[this.index];
  }

  start() {
    this.emitState();
    this.ticker = setInterval(() => {
      if (!this.playing || this.position() < this.track.durationMs - 40) return;
      if (this.repeat === 'track') this.seek(0);
      else this.next();
    }, 200);
  }

  stop() {
    clearInterval(this.ticker);
  }

  position(now = performance.now()) {
    return clamp(this.base + (this.playing ? now - this.at : 0), 0, this.track.durationMs);
  }

  emitState() {
    this.state = {
      ...this.info(this.track),
      isPlaying: this.playing,
      progressMs: this.position(),
      at: performance.now(),
      device: { name: 'Demo mode', type: 'Computer' },
      shuffle: this.shuffle,
      repeat: this.repeat,
      disallows: {},
    };
    this.emit('state', this.state);
  }

  async play() {
    this.base = this.position();
    this.at = performance.now();
    this.playing = true;
    this.emitState();
  }

  async pause() {
    this.base = this.position();
    this.at = performance.now();
    this.playing = false;
    this.emitState();
  }

  async seek(ms) {
    this.base = clamp(ms, 0, this.track.durationMs);
    this.at = performance.now();
    this.emitState();
  }

  async next() {
    this.index = (this.index + 1) % TRACKS.length;
    this.base = 0;
    this.at = performance.now();
    this.emitState();
  }

  async prev() {
    if (this.position() > 3500) return this.seek(0);
    this.index = (this.index - 1 + TRACKS.length) % TRACKS.length;
    this.base = 0;
    this.at = performance.now();
    this.emitState();
  }

  async toggleShuffle() {
    this.shuffle = !this.shuffle;
    this.emitState();
  }

  async cycleRepeat() {
    const order = ['off', 'context', 'track'];
    this.repeat = order[(order.indexOf(this.repeat) + 1) % order.length];
    this.emitState();
  }

  async peekNext() {
    return this.info(TRACKS[(this.index + 1) % TRACKS.length]);
  }

  lyricsFor(track) {
    const t = TRACKS.find((x) => track.uri === `demo:${x.id}`);
    return t ? buildResult({ synced: t.lrc }, t.durationMs) : { kind: 'none' };
  }

  async profile() {
    return { name: 'Demo', avatar: '' };
  }
}
