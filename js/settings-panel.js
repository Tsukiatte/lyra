import { icons } from './icons.js';
import { SCHEMA, settings } from './settings.js';
import { clamp, h } from './util.js';

let current = null;

export const settingsOpen = () => Boolean(current);
export const closeSettings = () => current?.close();

export function openSettings(opts = {}) {
  if (current) return current.close();
  const offs = [];
  const watch = (key, fn) => {
    offs.push(settings.on(key, fn));
    fn(settings.get(key));
  };

  const body = h('div', { class: 'sheet-body' });
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: () => close() });
  const sheet = h('aside', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' },
    h('header', { class: 'sheet-head' },
      h('h2', {}, 'Settings'),
      h('button', { class: 'icon-btn', 'aria-label': 'Close settings', html: icons.close, onclick: () => close() })),
    body);

  for (const group of SCHEMA) {
    const card = h('div', { class: 'group-card' });
    for (const item of group.items) card.append(row(item, watch));
    body.append(h('section', { class: 'group' }, h('h3', {}, group.title), card));
  }
  body.append(accountGroup(opts), aboutGroup());

  document.body.append(backdrop, sheet);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
    sheet.classList.add('is-open');
  }));

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  addEventListener('keydown', onKey);

  function close() {
    if (current !== handle) return;
    current = null;
    removeEventListener('keydown', onKey);
    offs.forEach((off) => off());
    backdrop.classList.remove('is-open');
    sheet.classList.remove('is-open');
    setTimeout(() => {
      backdrop.remove();
      sheet.remove();
    }, 650);
  }
  const handle = { close };
  current = handle;
  return handle;
}

function row(item, watch) {
  const stacked = item.type === 'segment' || item.type === 'range' || item.type === 'swatches';
  const value = h('span', { class: 'row-val' });
  const text = h('div', { class: 'row-text' },
    h('div', { class: 'row-label' }, item.label),
    item.hint && !stacked ? h('div', { class: 'row-hint' }, item.hint) : null,
    item.type === 'range' ? value : null);
  return h('div', { class: stacked ? 'row is-stack' : 'row' }, text, CONTROLS[item.type](item, watch, value));
}

const CONTROLS = {
  toggle(item, watch) {
    const b = h('button', { class: 'switch', role: 'switch', 'aria-label': item.label, onclick: () => settings.toggle(item.key) });
    watch(item.key, (v) => b.setAttribute('aria-checked', String(Boolean(v))));
    return b;
  },

  segment(item, watch) {
    const wrap = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': item.label, style: `--n:${item.options.length}` }, h('span', { class: 'seg-thumb' }));
    const buttons = item.options.map(([value, label]) => {
      const b = h('button', { role: 'radio', onclick: () => settings.set(item.key, value) }, label);
      b.dataset.value = value;
      wrap.append(b);
      return b;
    });
    watch(item.key, (v) => {
      wrap.style.setProperty('--i', String(Math.max(0, item.options.findIndex(([value]) => value === v))));
      buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === v)));
    });
    return wrap;
  },

  range(item, watch, value) {
    const input = h('input', { class: 'range', type: 'range', min: item.min, max: item.max, step: item.step, 'aria-label': item.label });
    input.addEventListener('input', () => settings.set(item.key, Math.round(parseFloat(input.value) * 1000) / 1000));
    watch(item.key, (v) => {
      if (document.activeElement !== input) input.value = String(v);
      value.textContent = item.format(v);
      input.style.setProperty('--f', `${((v - item.min) / (item.max - item.min)) * 100}%`);
    });
    return input;
  },

  stepper(item, watch) {
    const out = h('output', { title: 'Tap to reset' });
    const step = (dir) => settings.set(item.key, clamp(settings.get(item.key) + dir * item.step, item.min, item.max));
    out.addEventListener('click', () => settings.set(item.key, 0));
    watch(item.key, (v) => {
      out.textContent = item.format(v);
    });
    return h('div', { class: 'stepper' },
      h('button', { 'aria-label': 'Show lyrics later', html: icons.minus, onclick: () => step(-1) }),
      out,
      h('button', { 'aria-label': 'Show lyrics earlier', html: icons.plus, onclick: () => step(1) }));
  },

  swatches(item, watch) {
    const wrap = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': item.label });
    const buttons = item.options.map((color) => {
      const auto = color === 'auto';
      const b = h('button', {
        class: auto ? 'swatch swatch-auto' : 'swatch',
        role: 'radio',
        title: auto ? 'Match the artwork' : color,
        'aria-label': auto ? 'Match the artwork' : color,
        style: auto ? null : `--sw:${color}`,
        onclick: () => settings.set(item.key, color),
      }, auto ? 'A' : null);
      b.dataset.value = color;
      wrap.append(b);
      return b;
    });
    watch(item.key, (v) => buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === v))));
    return wrap;
  },
};

function actionRow(label, hint, action, onClick) {
  return h('div', { class: 'row' },
    h('div', { class: 'row-text' }, h('div', { class: 'row-label' }, label), h('div', { class: 'row-hint' }, hint)),
    h('button', { class: 'btn btn-glass btn-sm', onclick: onClick }, action));
}

function accountGroup({ demo, profile, onSignOut, onExitDemo, onClearCache }) {
  const card = h('div', { class: 'group-card' });
  if (demo) {
    card.append(actionRow('Demo mode', 'Sample songs with original lyrics', 'Exit demo', onExitDemo));
  } else {
    const name = h('div', { class: 'row-label' }, 'Spotify');
    const avatar = h('div', { class: 'avatar', html: icons.music });
    card.append(h('div', { class: 'row' }, avatar,
      h('div', { class: 'row-text' }, name, h('div', { class: 'row-hint' }, 'Connected to Spotify')),
      h('button', { class: 'btn btn-glass btn-sm', onclick: onSignOut }, 'Disconnect')));
    profile?.then((p) => {
      if (!p) return;
      name.textContent = p.name;
      if (p.avatar) avatar.replaceChildren(h('img', { src: p.avatar, alt: '' }));
    }).catch(() => {});
  }
  card.append(
    actionRow('Lyrics cache', 'Fetch every song’s lyrics fresh', 'Clear', (e) => {
      onClearCache?.();
      e.currentTarget.textContent = 'Cleared';
    }),
    actionRow('Reset settings', 'Back to the original look', 'Reset', () => settings.reset()),
  );
  return h('section', { class: 'group' }, h('h3', {}, 'Account'), card);
}

function aboutGroup() {
  const keys = [['Space', 'Play / pause'], ['← →', 'Seek 5s'], ['L', 'Switch view'], ['[ ]', 'Lyrics timing'], ['S', 'Settings']];
  return h('section', { class: 'group' }, h('h3', {}, 'About'),
    h('div', { class: 'group-card about' },
      h('p', {}, 'Lyrics come from LRCLIB, a free community-made library. Playback info comes from Spotify. Everything Lyra remembers stays on this device.'),
      h('div', { class: 'keys' }, keys.map(([k, v]) => h('div', { class: 'key' }, h('kbd', {}, k), h('span', {}, v))))));
}
