// The styles gallery: one live, scaled-down Lyra demo per theme.
import { settings } from './settings.js';
import { ensureFonts, THEMES } from './themes.js';
import { h } from './util.js';

const PREVIEW_W = 1440;
const START_MS = 29000; // mid-chorus, so every preview shows a line being sung

const grid = document.getElementById('grid');
const current = settings.get('theme');
ensureFonts(THEMES.map((t) => t.id));

const scale = new ResizeObserver((entries) => {
  for (const entry of entries) entry.target.style.setProperty('--k', String(entry.contentRect.width / PREVIEW_W));
});

THEMES.forEach((theme, i) => {
  const frame = h('div', { class: 'frame' },
    h('iframe', {
      src: `./?demo&embed&t=${START_MS}&theme=${theme.id}`,
      title: `${theme.name} style, live preview`,
      loading: 'lazy',
      tabindex: '-1',
      'aria-hidden': 'true',
    }),
    theme.id === current ? h('span', { class: 'badge' }, 'Current') : null);
  const name = h('h2', { class: 'name' }, theme.name);
  name.style.fontFamily = theme.preview.font;
  grid.append(h('a', { class: 'card', href: `./?theme=${theme.id}` },
    frame,
    h('div', { class: 'meta' },
      h('div', {},
        h('div', { class: 'num' }, String(i + 1).padStart(2, '0')),
        name,
        h('p', { class: 'tag' }, theme.tagline)),
      h('span', { class: 'use' }, theme.id === current ? 'Keep this style' : 'Use this style'))));
  scale.observe(frame);
});
