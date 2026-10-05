import { Emitter, store } from './util.js';

export const DEFAULTS = Object.freeze({
  layout: 'split',
  showArt: true,
  reflection: true,
  showInfo: true,
  showProgress: true,
  showControls: true,
  showClock: true,
  showDevice: true,
  upNext: true,
  showLyrics: true,
  lyricSize: 1,
  lyricAlign: 'left',
  lyricFont: 'geist',
  wordSweep: true,
  glow: true,
  depthBlur: true,
  cascade: true,
  instrumentalDots: true,
  tapToSeek: true,
  autoScrollPlain: true,
  syncOffset: 0,
  bgStyle: 'aurora',
  bgMotion: 1,
  bgDim: 0.3,
  grain: true,
  accent: 'auto',
  lowPower: false,
  syncRate: 'balanced',
  autoHide: true,
});

const KEY = 'lyra.settings.v1';

function load() {
  const saved = store.get(KEY, {}) || {};
  const values = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (key in saved && typeof saved[key] === typeof DEFAULTS[key]) values[key] = saved[key];
  }
  return values;
}

class Settings extends Emitter {
  constructor() {
    super();
    this.values = load();
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    if (!(key in DEFAULTS) || this.values[key] === value) return;
    this.values[key] = value;
    store.set(KEY, this.values);
    this.emit(key, value);
    this.emit('change', key, value);
  }

  toggle(key) {
    this.set(key, !this.values[key]);
  }

  reset() {
    const before = this.values;
    this.values = { ...DEFAULTS };
    store.set(KEY, this.values);
    for (const key of Object.keys(DEFAULTS)) {
      if (before[key] === this.values[key]) continue;
      this.emit(key, this.values[key]);
      this.emit('change', key, this.values[key]);
    }
  }
}

export const settings = new Settings();

export const LAYOUTS = [
  ['split', 'Split'],
  ['lyrics', 'Lyrics'],
  ['cover', 'Cover'],
  ['stage', 'Stage'],
];

export const fmtOffset = (v) =>
  v === 0 ? 'In sync' : `${(Math.abs(v) / 1000).toFixed(1)}s ${v > 0 ? 'earlier' : 'later'}`;

const pct = (v) => `${Math.round(v * 100)}%`;

// Drives the settings sheet. Every key here is live: changing it re-styles the app instantly.
export const SCHEMA = [
  {
    title: 'Layout',
    items: [
      { key: 'layout', type: 'segment', label: 'View', options: LAYOUTS },
      { key: 'showArt', type: 'toggle', label: 'Album artwork' },
      { key: 'reflection', type: 'toggle', label: 'Glass reflection', hint: 'A mirrored glow under the artwork' },
      { key: 'showInfo', type: 'toggle', label: 'Song details' },
      { key: 'showProgress', type: 'toggle', label: 'Progress bar' },
      { key: 'showControls', type: 'toggle', label: 'Playback controls' },
      { key: 'showClock', type: 'toggle', label: 'Clock' },
      { key: 'showDevice', type: 'toggle', label: 'Now playing on' },
      { key: 'upNext', type: 'toggle', label: 'Up next preview', hint: 'Shows the next song near the end' },
    ],
  },
  {
    title: 'Lyrics',
    items: [
      { key: 'showLyrics', type: 'toggle', label: 'Show lyrics' },
      { key: 'lyricSize', type: 'range', label: 'Text size', min: 0.7, max: 1.5, step: 0.05, format: pct },
      { key: 'lyricAlign', type: 'segment', label: 'Alignment', options: [['left', 'Left'], ['center', 'Center']] },
      { key: 'lyricFont', type: 'segment', label: 'Typeface', options: [['geist', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']] },
      { key: 'wordSweep', type: 'toggle', label: 'Karaoke sweep', hint: 'Words light up as they’re sung' },
      { key: 'glow', type: 'toggle', label: 'Active line glow' },
      { key: 'depthBlur', type: 'toggle', label: 'Depth blur', hint: 'Softens lines away from the current one' },
      { key: 'cascade', type: 'toggle', label: 'Cascade scrolling' },
      { key: 'instrumentalDots', type: 'toggle', label: 'Instrumental breaks', hint: 'Animated dots between verses' },
      { key: 'tapToSeek', type: 'toggle', label: 'Tap a line to jump to it' },
      { key: 'autoScrollPlain', type: 'toggle', label: 'Auto-scroll unsynced lyrics' },
      { key: 'syncOffset', type: 'stepper', label: 'Timing', hint: 'Nudge if lyrics run ahead or behind', step: 100, min: -3000, max: 3000, format: fmtOffset },
    ],
  },
  {
    title: 'Background',
    items: [
      { key: 'bgStyle', type: 'segment', label: 'Style', options: [['aurora', 'Aurora'], ['art', 'Artwork'], ['tint', 'Tint'], ['black', 'Black']] },
      { key: 'bgMotion', type: 'range', label: 'Motion', min: 0, max: 2, step: 0.1, format: (v) => (v === 0 ? 'Still' : `${v.toFixed(1)}×`) },
      { key: 'bgDim', type: 'range', label: 'Dim', min: 0, max: 0.8, step: 0.05, format: pct },
      { key: 'grain', type: 'toggle', label: 'Film grain' },
    ],
  },
  {
    title: 'Accent',
    items: [
      { key: 'accent', type: 'swatches', label: 'Color', options: ['auto', '#f5f5f7', '#9ad1ff', '#b4a7ff', '#ff9ec7', '#ffcf8a', '#8ff0c4'] },
    ],
  },
  {
    title: 'Performance',
    items: [
      { key: 'lowPower', type: 'toggle', label: 'Low power mode', hint: 'Fewer effects — smoother on older cars' },
      { key: 'syncRate', type: 'segment', label: 'Sync rate', options: [['fast', 'Fast'], ['balanced', 'Balanced'], ['saver', 'Saver']] },
      { key: 'autoHide', type: 'toggle', label: 'Auto-hide controls' },
    ],
  },
];
