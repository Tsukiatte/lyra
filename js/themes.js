// Visual styles. Each theme is a set of CSS overrides in css/themes.css keyed by
// <html data-theme>, plus the bits JavaScript needs: fonts to load, how the accent
// color is chosen, and the background it looks best on.

import { DEFAULT_PALETTE, hexToRgb, hslToRgb, rgbToHsl } from './palette.js';
import { settings } from './settings.js';

const GOLD = 'linear-gradient(135deg, #fff1cc 0%, #e2c27d 24%, #b38a46 50%, #f3dca2 72%, #a77d3b 100%)';
const CHROME = 'linear-gradient(180deg, #ffffff 0%, #e8ecf1 38%, #9aa3b0 50%, #f4f6f9 60%, #c4cbd5 80%, #ffffff 100%)';

// accent: null = from the album art, [r,g,b] = fixed, 'neon' = album color pushed to full glow.
export const THEMES = [
  {
    id: 'lumiere',
    name: 'Lumière',
    tagline: 'Frosted glass over living color',
    bg: 'aurora',
    accent: null,
    preview: { bg: 'radial-gradient(120% 100% at 0% 0%, #3b1d6e, #120c2a 58%, #07070a)', ink: '#ffffff', dim: 'rgba(255,255,255,.34)', font: "'Geist', sans-serif", weight: 700, art: 'linear-gradient(135deg, #ff9a62, #b33a72 50%, #3a1863)', radius: '7px', accent: '#c9cfff' },
  },
  {
    id: 'noir',
    name: 'Noir',
    tagline: 'Editorial black, set in Bodoni',
    bg: 'black',
    accent: [242, 242, 242],
    fonts: 'Bodoni+Moda:ital,opsz,wght@0,6..96,400..900;1,6..96,400..900',
    preview: { bg: '#000000', ink: '#ffffff', dim: 'rgba(255,255,255,.26)', font: "'Bodoni Moda', serif", weight: 500, art: 'linear-gradient(160deg, #ececec, #5e5e5e 55%, #111111)', radius: '0px', accent: '#ffffff' },
  },
  {
    id: 'aurum',
    name: 'Aurum',
    tagline: 'Black lacquer and champagne gold',
    bg: 'black',
    accent: [214, 178, 110],
    fonts: 'Cormorant+Garamond:ital,wght@0,400..700;1,400..700',
    preview: { bg: 'radial-gradient(100% 90% at 10% 0%, #3a2c14, #0b0906 65%)', ink: '#f6e7c3', fill: GOLD, dim: 'rgba(236,222,190,.32)', font: "'Cormorant Garamond', serif", weight: 600, art: 'linear-gradient(135deg, #f3dca2, #a77d3b 55%, #2a1e0c)', radius: '3px', accent: '#d6b26e' },
  },
  {
    id: 'chrome',
    name: 'Chrome',
    tagline: 'Liquid metal, built for speed',
    bg: 'aurora',
    accent: [207, 227, 255],
    fonts: 'Unbounded:wght@300..800',
    preview: { bg: 'linear-gradient(160deg, #1d242d, #07090c 70%)', ink: '#f2f5f9', fill: CHROME, dim: 'rgba(200,210,225,.3)', font: "'Unbounded', sans-serif", weight: 600, art: 'linear-gradient(135deg, #f4f6f9, #8a94a3 50%, #2b313a)', radius: '11px', accent: '#cfe3ff' },
  },
  {
    id: 'frost',
    name: 'Frost',
    tagline: 'Daylight white glass',
    bg: 'aurora',
    accent: null,
    light: true,
    preview: { bg: 'radial-gradient(120% 100% at 0% 0%, #e7dcfb, #f4f6fb 55%, #dde8f5)', ink: '#0b0c10', dim: 'rgba(11,12,16,.28)', font: "'Geist', sans-serif", weight: 700, art: 'linear-gradient(135deg, #a8c0ff, #f7b2d9 60%, #fde2c8)', radius: '8px', accent: '#4f4fd0' },
  },
  {
    id: 'neon',
    name: 'Neon',
    tagline: 'Midnight city glow',
    bg: 'black',
    accent: 'neon',
    fonts: 'Space+Grotesk:wght@400..700',
    preview: { bg: 'radial-gradient(90% 80% at 85% 0%, rgba(0,229,255,.32), transparent 60%), #04050c', ink: '#ffffff', glow: '#00e5ff', dim: 'rgba(150,175,255,.34)', font: "'Space Grotesk', sans-serif", weight: 700, art: 'linear-gradient(135deg, #00e5ff, #7b2ff7 55%, #ff2fb9)', radius: '6px', accent: '#00e5ff' },
  },
  {
    id: 'riviera',
    name: 'Riviera',
    tagline: 'Cream, navy and a gallery frame',
    bg: 'black',
    accent: [176, 141, 87],
    light: true,
    fonts: 'Playfair+Display:ital,wght@0,400..900;1,400..900',
    preview: { bg: 'linear-gradient(180deg, #faf6ee, #ece3d2)', ink: '#14213d', dim: 'rgba(20,33,61,.3)', font: "'Playfair Display', serif", weight: 600, art: 'linear-gradient(135deg, #14213d, #3c5a8a 55%, #e4c590)', radius: '1px', accent: '#b08d57', mat: true },
  },
];

export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];

// Picking a style also switches to the background it was designed for and its typeface.
export function applyTheme(id) {
  const theme = themeById(id);
  settings.set('theme', theme.id);
  settings.set('bgStyle', theme.bg);
  settings.set('lyricFont', 'theme');
}

export function ensureFonts(ids = [settings.get('theme')]) {
  for (const id of ids) {
    const theme = themeById(id);
    if (!theme.fonts || document.querySelector(`link[data-font="${theme.id}"]`)) continue;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${theme.fonts}&display=swap`;
    link.dataset.font = theme.id;
    // Text metrics change once the font arrives: let the lyrics re-measure.
    link.addEventListener('load', () => document.fonts.ready.then(() => dispatchEvent(new Event('lyra:fonts'))));
    document.head.append(link);
  }
}

let palette = DEFAULT_PALETTE;

export function setPalette(next) {
  palette = next || DEFAULT_PALETTE;
  applyAccent();
}

export function applyAccent() {
  const theme = themeById(settings.get('theme'));
  const choice = settings.get('accent');
  const custom = choice !== 'auto' ? hexToRgb(choice) : null;
  let rgb = custom || (Array.isArray(theme.accent) ? theme.accent : palette.accentRgb);
  if (!custom && theme.accent === 'neon') rgb = neonize(rgb);
  if (theme.light && !Array.isArray(theme.accent)) rgb = deepen(rgb);
  const style = document.documentElement.style;
  style.setProperty('--accent', `rgb(${rgb.join(', ')})`);
  style.setProperty('--accent-rgb', rgb.join(', '));
}

function neonize(rgb) {
  const [h, s] = rgbToHsl(rgb);
  return s < 0.15 ? [0, 229, 255] : hslToRgb([h, Math.max(s, 0.9), 0.62]).map(Math.round);
}

// On light backgrounds the accent needs to be dark enough to read.
function deepen(rgb) {
  const [h, s, l] = rgbToHsl(rgb);
  return s < 0.12 ? [44, 46, 58] : hslToRgb([h, Math.max(s, 0.5), Math.min(l, 0.42)]).map(Math.round);
}
