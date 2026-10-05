import { clamp } from './util.js';

export const DEFAULT_PALETTE = {
  aurora: [[0.11, 0.09, 0.27], [0.23, 0.12, 0.42], [0.06, 0.23, 0.36], [0.35, 0.11, 0.36], [0.08, 0.16, 0.29]],
  accent: '#c9cfff',
  accentRgb: [201, 207, 255],
};

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = src;
  });
}

// Pulls a 5-color background palette and a legible accent out of album art.
export function extractPalette(img) {
  const S = 40;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, S, S);
  let data;
  try {
    data = ctx.getImageData(0, 0, S, S).data;
  } catch {
    return null; // cross-origin image without CORS
  }
  const pts = [];
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200) pts.push([data[i], data[i + 1], data[i + 2]]);
  if (!pts.length) return null;
  return buildPalette(kmeans(pts, 6));
}

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function kmeans(pts, k) {
  const centers = [pts[Math.floor(pts.length / 2)].slice()];
  while (centers.length < k) {
    let best = null;
    let bestD = -1;
    for (const p of pts) {
      let d = Infinity;
      for (const c of centers) d = Math.min(d, dist2(p, c));
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
    if (bestD <= 0) break;
    centers.push(best.slice());
  }
  const assign = new Uint8Array(pts.length);
  for (let iter = 0; iter < 10; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) {
      let bi = 0;
      let bd = Infinity;
      for (let j = 0; j < centers.length; j++) {
        const d = dist2(pts[i], centers[j]);
        if (d < bd) {
          bd = d;
          bi = j;
        }
      }
      assign[i] = bi;
      const s = sums[bi];
      s[0] += pts[i][0];
      s[1] += pts[i][1];
      s[2] += pts[i][2];
      s[3]++;
    }
    for (let j = 0; j < centers.length; j++) if (sums[j][3]) centers[j] = sums[j].slice(0, 3).map((v) => v / sums[j][3]);
  }
  const counts = new Array(centers.length).fill(0);
  for (const a of assign) counts[a]++;
  return centers
    .map((rgb, j) => ({ rgb, share: counts[j] / pts.length, hsl: rgbToHsl(rgb) }))
    .filter((c) => c.share > 0)
    .sort((a, b) => b.share - a.share);
}

function buildPalette(clusters) {
  const score = (c) => c.hsl[1] * (1 - Math.abs(c.hsl[2] - 0.55)) * Math.pow(c.share, 0.3);
  const vivid = clusters.reduce((a, b) => (score(b) > score(a) ? b : a));
  const [h, s, l] = vivid.hsl;
  const accentHsl = s < 0.12 ? [h, 0.08, 0.86] : [h, clamp(s * 1.1, 0.5, 0.95), clamp(Math.max(l, 0.68), 0.68, 0.8)];
  const accentRgb = hslToRgb(accentHsl).map(Math.round);

  const picks = clusters.slice(0, 5).map((c) => c.hsl);
  for (let i = 0; picks.length < 5; i++) {
    const [ph, ps, pl] = picks[i % Math.max(1, picks.length)] || [0.7, 0.3, 0.3];
    picks.push([(ph + 0.035 * (i + 1)) % 1, ps, pl * (0.75 + 0.1 * (i % 3))]);
  }
  // Keep backgrounds rich but dark enough for white lyrics on top.
  const aurora = picks.map(([ph, ps, pl]) => hslToRgb([ph, clamp(ps * 1.1, 0, 0.85), clamp(pl, 0.12, 0.46)]).map((v) => v / 255));
  return { aurora, accent: toHex(accentRgb), accentRgb };
}

export function rgbToHsl([r, g, b]) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

export function hslToRgb([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

export const toHex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
