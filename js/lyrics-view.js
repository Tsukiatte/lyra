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

export class LyricsView {
  constructor(root, { onSeek } = {}) {
    this.root = root;
    this.onSeek = onSeek;
    this.inner = h('div', { class: 'ly-inner' });
    this.note = h('div', { class: 'ly-note' });
    root.append(this.inner, this.note);
    this.items = [];
    this.active = -1;
    this.userOffset = 0;
    this.userUntil = 0;
    this.dragging = false;
    this.plainFrac = 0;
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
    this.inner.style.transform = '';
    this.note.textContent = '';
    this.active = -1;
    this.userOffset = 0;
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

  measure() {
    this.viewH = this.root.clientHeight;
    this.anchor = parseFloat(getComputedStyle(this.root).getPropertyValue('--anchor')) || 0.38;
    this.contentH = this.inner.scrollHeight;
    if (this.mode === 'synced') {
      this.tops = this.items.map((it) => it.el.offsetTop);
      this.heights = this.items.map((it) => it.el.offsetHeight);
      this.layout(true);
    } else if (this.mode === 'plain') {
      this.applyPlain();
    }
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
      if (this.userOffset && !this.dragging && now > this.userUntil) {
        this.userOffset = 0;
        this.layout();
      }
    } else if (this.mode === 'plain') {
      let dirty = Math.abs(frac - this.plainFrac) > 0.0004;
      if (this.userOffset && !this.dragging && now > this.userUntil) {
        this.userOffset = 0;
        dirty = true;
      }
      if (dirty) {
        this.plainFrac = frac;
        this.applyPlain();
      }
    }
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

  layout(instant = false) {
    if (this.mode !== 'synced' || !this.items.length || !this.tops) return;
    const i = clamp(this.active, 0, this.items.length - 1);
    const base = this.viewH * this.anchor - (this.tops[i] + this.heights[i] / 2);
    // Don't let manual scrolling fling the lyrics out of view.
    const minY = Math.min(base, this.viewH * 0.5 - this.contentH);
    const maxY = Math.max(base, this.viewH * 0.5);
    this.userOffset = clamp(base + this.userOffset, minY, maxY) - base;
    const y = Math.round(base + this.userOffset);
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
  }

  applyPlain() {
    const max = Math.max(0, this.contentH - this.viewH * 0.55);
    const auto = settings.values.autoScrollPlain ? -this.plainFrac * max : 0;
    this.userOffset = clamp(this.userOffset, -max - auto, -auto);
    this.inner.style.transform = `translate3d(0, ${Math.round(auto + this.userOffset + this.viewH * 0.1)}px, 0)`;
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
    let pid = null;
    let startY = 0;
    let startOffset = 0;
    let moved = false;
    root.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      pid = e.pointerId;
      startY = e.clientY;
      startOffset = this.userOffset;
      moved = false;
    });
    root.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      const dy = e.clientY - startY;
      if (!moved && Math.abs(dy) > 8) {
        moved = true;
        this.dragging = true;
        root.classList.add('is-dragging');
        try {
          root.setPointerCapture(pid);
        } catch {
          /* pointer already gone */
        }
      }
      if (moved) {
        this.userOffset = startOffset + dy;
        this.userUntil = performance.now() + 4000;
        this.reflow();
      }
    });
    const finish = (e, cancelled) => {
      if (e.pointerId !== pid) return;
      pid = null;
      if (moved) {
        this.dragging = false;
        root.classList.remove('is-dragging');
        this.userUntil = performance.now() + 3500;
      } else if (!cancelled) {
        this.tap(e.target);
      }
    };
    root.addEventListener('pointerup', (e) => finish(e, false));
    root.addEventListener('pointercancel', (e) => finish(e, true));
    root.addEventListener('wheel', (e) => {
      if (this.mode !== 'synced' && this.mode !== 'plain') return;
      e.preventDefault();
      this.userOffset -= e.deltaY;
      this.userUntil = performance.now() + 3500;
      this.reflow();
    }, { passive: false });
  }

  reflow() {
    if (this.mode === 'synced') this.layout(true);
    else if (this.mode === 'plain') this.applyPlain();
  }

  tap(target) {
    if (this.mode !== 'synced' || !settings.values.tapToSeek) return;
    const el = target.closest?.('.ly-line, .ly-gap');
    const item = el && this.items.find((it) => it.el === el);
    if (!item) return;
    el.classList.remove('is-tapped');
    void el.offsetWidth;
    el.classList.add('is-tapped');
    this.userOffset = 0;
    this.onSeek?.(item.start);
  }
}
