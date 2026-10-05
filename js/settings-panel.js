import { icons } from './icons.js';
import { SCHEMA, settings } from './settings.js';
import { chooseTheme, ensureFonts, THEMES } from './themes.js';
import { clamp, h, Spring } from './util.js';

let current = null;

export const settingsOpen = () => Boolean(current);
export const closeSettings = () => current?.close();

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// The sheet rides a spring: it opens with weight while the app recedes behind it, can be
// pulled out from the screen edge (opts.pull) and flung closed, and its scrolling glides.
export function openSettings(opts = {}) {
  if (current) return current.close();
  const offs = [];
  const watch = (key, fn) => {
    offs.push(settings.on(key, fn));
    fn(settings.get(key));
  };

  const content = h('div', { class: 'sheet-content' });
  const body = h('div', { class: 'sheet-body' }, content);
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: () => close() });
  const sheet = h('aside', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Settings' },
    h('header', { class: 'sheet-head' },
      h('h2', {}, 'Settings'),
      h('button', { class: 'icon-btn', 'aria-label': 'Close settings', html: icons.close, onclick: () => close() })),
    body);

  for (const group of SCHEMA) {
    const card = h('div', { class: 'group-card' });
    for (const item of group.items) card.append(row(item, watch));
    content.append(h('section', { class: 'group' }, h('h3', {}, group.title), card));
  }
  content.append(accountGroup(opts), aboutGroup());

  const app = document.getElementById('app');
  document.body.append(backdrop, sheet);
  document.documentElement.classList.add('has-sheet');

  // ── Position on a spring ──────────────────────────────────────────────────
  let W = sheet.offsetWidth + 40;
  const spring = new Spring(W, { stiffness: 80, damping: 15 });
  let raf = 0;
  let last = 0;
  let closing = false;

  function render(x) {
    const p = clamp(1 - x / W, 0, 1);
    sheet.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0)`;
    backdrop.style.opacity = p.toFixed(3);
    if (app) {
      app.style.transform = p > 0.001 && !settings.values.lowPower
        ? `translate3d(${(-26 * p).toFixed(2)}px, 0, 0) scale(${(1 - 0.05 * p).toFixed(4)})`
        : '';
    }
  }

  function loop(now) {
    const settled = spring.step(Math.min(0.05, (now - last) / 1000));
    last = now;
    render(spring.value);
    if (settled) {
      raf = 0;
      if (closing) finish();
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  function animateTo(target, velocity = spring.velocity) {
    spring.target = target;
    spring.velocity = velocity;
    if (reduceMotion()) {
      spring.value = target;
      render(target);
      if (closing) finish();
      return;
    }
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
  }

  // ── Dragging: fling to close, or follow a finger pulling it from the edge ──
  let drag = null;
  let pending = null;
  const samples = [];

  function beginDrag(pointerId, startX, x0) {
    drag = { id: pointerId, startX, x0 };
    samples.length = 0;
    cancelAnimationFrame(raf);
    raf = 0;
    try {
      sheet.setPointerCapture(pointerId);
    } catch {
      /* pointer already released */
    }
  }

  function moveDrag(clientX) {
    let x = drag.x0 + (clientX - drag.startX);
    if (x < 0) x = -16 * Math.log1p(-x / 16); // rubber band past fully open
    spring.value = x;
    const t = performance.now();
    samples.push([t, x]);
    while (samples.length > 2 && t - samples[0][0] > 90) samples.shift();
    render(x);
  }

  function endDrag() {
    const [t0, x0] = samples[0] || [0, 0];
    const [t1, x1] = samples[samples.length - 1] || [0, 0];
    const fresh = performance.now() - t1 < 80; // a pause before lifting means no fling
    const v = fresh && t1 > t0 ? ((x1 - x0) / (t1 - t0)) * 1000 : 0;
    drag = null;
    if (v > 450 || (spring.value > W * 0.32 && v > -250)) close(v);
    else animateTo(0, v);
  }

  sheet.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || drag || e.target.closest('input, select, .seg')) return;
    pending = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  sheet.addEventListener('pointermove', (e) => {
    if (drag?.id === e.pointerId) return moveDrag(e.clientX);
    if (pending?.id !== e.pointerId) return;
    const dx = e.clientX - pending.x;
    const dy = e.clientY - pending.y;
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      beginDrag(e.pointerId, pending.x, spring.value);
      pending = null;
      moveDrag(e.clientX);
    } else if (Math.abs(dy) > 10) {
      pending = null;
    }
  });
  const release = (e) => {
    if (pending?.id === e.pointerId) pending = null;
    if (drag?.id === e.pointerId) endDrag();
  };
  sheet.addEventListener('pointerup', release);
  sheet.addEventListener('pointercancel', release);

  // ── Heavy scrolling: wheel input glides to a stop and rubber-bands at the ends ─
  let target = 0;
  let pos = 0;
  let glideRaf = 0;
  let ours = false;
  const maxScroll = () => body.scrollHeight - body.clientHeight;

  body.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return;
    e.preventDefault();
    if (!glideRaf) target = pos = body.scrollTop;
    target = clamp(target + e.deltaY * (e.deltaMode === 1 ? 32 : 1), -140, maxScroll() + 140);
    if (!glideRaf) glideRaf = requestAnimationFrame(glide);
  }, { passive: false });

  function glide() {
    const max = maxScroll();
    if (target < 0) target = target * 0.82 > -0.5 ? 0 : target * 0.82;
    else if (target > max) target = (target - max) * 0.82 < 0.5 ? max : max + (target - max) * 0.82;
    pos += (target - pos) * 0.085;
    const clamped = clamp(pos, 0, max);
    ours = true;
    body.scrollTop = clamped;
    content.style.transform = Math.abs(pos - clamped) > 0.1 ? `translate3d(0, ${((clamped - pos) * 0.45).toFixed(2)}px, 0)` : '';
    if (Math.abs(target - pos) > 0.3) glideRaf = requestAnimationFrame(glide);
    else {
      glideRaf = 0;
      content.style.transform = '';
    }
  }

  body.addEventListener('scroll', () => {
    if (ours) ours = false;
    else if (!glideRaf) target = pos = body.scrollTop;
    sheet.classList.toggle('is-scrolled', body.scrollTop > 6);
  }, { passive: true });

  // ── Sections drift into place as they come into view ─────────────────────
  let batch = 0;
  let batchTimer = 0;
  let firstBatch = true;
  const reveal = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.style.setProperty('--delay', `${(firstBatch ? 140 : 0) + batch++ * 75}ms`);
      entry.target.classList.add('is-in');
      reveal.unobserve(entry.target);
    }
    clearTimeout(batchTimer);
    batchTimer = setTimeout(() => {
      batch = 0;
      firstBatch = false;
    }, 120);
  }, { root: body, threshold: 0.04 });
  for (const group of content.querySelectorAll('.group')) {
    if (reduceMotion()) group.classList.add('is-in');
    else reveal.observe(group);
  }

  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  addEventListener('keydown', onKey);

  function close(velocity = 0) {
    if (closing) return;
    closing = true;
    if (current === handle) current = null;
    removeEventListener('keydown', onKey);
    offs.forEach((off) => off());
    reveal.disconnect();
    backdrop.style.pointerEvents = 'none';
    W = sheet.offsetWidth + 40;
    animateTo(W, velocity);
  }

  function finish() {
    cancelAnimationFrame(glideRaf);
    backdrop.remove();
    sheet.remove();
    if (!current) {
      if (app) app.style.transform = '';
      document.documentElement.classList.remove('has-sheet');
    }
  }

  const handle = { close };
  current = handle;
  render(W);
  if (opts.pull) beginDrag(opts.pull.pointerId, opts.pull.startX, W);
  else requestAnimationFrame(() => animateTo(0));
  return handle;
}

function row(item, watch) {
  let el;
  if (item.type === 'themes') {
    el = h('div', { class: 'row is-stack' }, CONTROLS.themes(item, watch));
  } else {
    const stacked = item.type === 'segment' || item.type === 'range' || item.type === 'swatches';
    const value = h('span', { class: 'row-val' });
    const text = h('div', { class: 'row-text' },
      h('div', { class: 'row-label' }, item.label),
      item.hint && !stacked ? h('div', { class: 'row-hint' }, item.hint) : null,
      item.type === 'range' ? value : null);
    el = h('div', { class: stacked ? 'row is-stack' : 'row' },
      text,
      CONTROLS[item.type](item, watch, value),
      stacked && item.hint ? h('div', { class: 'row-note' }, item.hint) : null);
  }
  if (item.showIf) watch(item.showIf, (on) => { el.hidden = !on; });
  return el;
}

const CONTROLS = {
  themes(item, watch) {
    ensureFonts(THEMES.map((t) => t.id));
    const grid = h('div', { class: 'themes', role: 'radiogroup', 'aria-label': 'Style' });
    const cards = THEMES.map((t) => {
      const p = t.preview;
      const on = h('div', { class: 'tc-on' }, 'City lights');
      if (p.fill) on.style.cssText = `background:${p.fill};-webkit-background-clip:text;background-clip:text;color:transparent`;
      if (p.glow) on.style.textShadow = `0 0 10px ${p.glow}, 0 0 24px ${p.glow}`;
      const art = h('div', { class: 'tc-art' });
      art.style.cssText = `background:${p.art};border-radius:${p.radius}` + (p.mat ? ';box-shadow:0 0 0 3px #fffaf0, 0 0 0 4px rgba(20,33,61,.15)' : '');
      const scene = h('div', { class: 'tc-scene' }, art,
        h('div', { class: 'tc-lines' }, on, h('div', { class: 'tc-off' }, 'melting into gold')),
        h('span', { class: 'tc-dot' }));
      scene.style.cssText = `background:${p.bg};color:${p.ink};font-family:${p.font};font-weight:${p.weight};--tc-dim:${p.dim};--tc-accent:${p.accent}`;
      const card = h('button', { class: 'theme-card', role: 'radio', onclick: () => chooseTheme(t.id) },
        scene,
        h('div', { class: 'tc-name' }, t.name),
        h('div', { class: 'tc-tag' }, t.tagline));
      card.dataset.value = t.id;
      grid.append(card);
      return card;
    });
    watch(item.key, (v) => cards.forEach((c) => c.setAttribute('aria-checked', String(c.dataset.value === v))));
    return h('div', { class: 'themes-wrap' }, grid, h('a', { class: 'themes-link', href: 'styles.html' }, 'Compare all styles side by side →'));
  },

  select(item, watch) {
    const options = item.options === 'themes' ? THEMES.map((t) => [t.id, t.name]) : item.options;
    const select = h('select', { class: 'select', 'aria-label': item.label }, options.map(([value, label]) => h('option', { value }, label)));
    select.addEventListener('change', () => settings.set(item.key, select.value));
    watch(item.key, (v) => {
      select.value = v;
    });
    return h('span', { class: 'select-wrap' }, select);
  },

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
