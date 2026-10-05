import { deviceIcon, icons } from './icons.js';
import { clearLyricsCache, getLyrics, prefetchLyrics } from './lyrics.js';
import { LyricsView } from './lyrics-view.js';
import { DEFAULT_PALETTE, extractPalette, loadImage } from './palette.js';
import { closeSettings, openSettings, settingsOpen } from './settings-panel.js';
import { EMBED, fmtOffset, LAYOUTS, settings } from './settings.js';
import { setPalette } from './themes.js';
import { clamp, fmtTime, h, store } from './util.js';
import { Visualizer } from './visualizer.js';

const PERF_KEY = 'lyra.perfChecked';
const LAYOUT_NAMES = Object.fromEntries(LAYOUTS);
const RELAYOUT = new Set(['theme', 'focusLines', 'layout', 'lyricSize', 'lyricFont', 'lyricAlign', 'showArt', 'showInfo', 'showProgress', 'showControls', 'showLyrics', 'reflection']);
const WAKE_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel'];

const replay = (el, cls) => {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
};

// Progress-bar background marking where the singing is (merged lyric lines).
function lyricsMap(result, duration) {
  if (result?.kind !== 'synced' || !duration) return '';
  const spans = [];
  for (const line of result.lines) {
    if (line.gap) continue;
    const a = line.start / duration;
    const b = Math.min(1, line.end / duration);
    const last = spans[spans.length - 1];
    if (last && a - last[1] < 0.006) last[1] = b;
    else spans.push([a, b]);
  }
  const pct = (v) => `${(v * 100).toFixed(2)}%`;
  const stops = [];
  let at = 0;
  for (const [a, b] of spans) {
    stops.push(`transparent ${pct(at)}`, `transparent ${pct(a)}`, `var(--map) ${pct(a)}`, `var(--map) ${pct(b)}`);
    at = b;
  }
  stops.push(`transparent ${pct(at)}`, 'transparent 100%');
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

function friendly(err) {
  if (err?.reason === 'NO_ACTIVE_DEVICE' || err?.status === 404) return 'No active Spotify device';
  if (err?.reason === 'PREMIUM_REQUIRED') return 'Controls need Spotify Premium';
  if (err?.status === 403) return 'Spotify didn’t allow that right now';
  if (err?.status === 429) return 'Spotify asked us to slow down';
  return 'Couldn’t reach Spotify';
}

export function mountPlayer(app, { source, bg, demo = false, welcome = false, onExit, onSignedOut }) {
  let track = null;
  let duration = 0;
  let playing = null;
  let nextTrack = null;
  let job = 0;
  let raf = 0;
  let lastSec = -1;
  let lastPf = -1;
  let scrub = null;
  let wakeTimer = 0;
  let destroyed = false;
  const offs = [];
  const watch = (key, fn) => {
    offs.push(settings.on(key, fn));
    fn(settings.get(key));
  };

  // ── Markup ────────────────────────────────────────────────────────────────
  const ctl = (cls, icon, label, onclick) => h('button', { class: `ctl ${cls}`, 'aria-label': label, title: label, html: icon, onclick });

  const artA = h('img', { alt: '', crossorigin: 'anonymous' });
  const artB = h('img', { alt: '', crossorigin: 'anonymous' });
  const art = h('div', { class: 'art is-empty' }, artA, artB, h('div', { class: 'art-ph', html: icons.music }), h('div', { class: 'art-sheen' }));
  const artHeart = h('div', { class: 'art-heart', html: icons.heart });
  const artWrap = h('div', { class: 'art-wrap', title: 'Tap to play or pause · swipe to skip · double-tap to like' }, art, artHeart);

  const albumEl = h('div', { class: 'np-album' });
  const titleEl = h('div', { class: 'np-title' }, h('span'));
  const artistEl = h('div', { class: 'np-artist' });
  const likeBtn = h('button', { class: 'like', 'aria-label': 'Save to Liked Songs', title: 'Like', html: icons.heart, hidden: true, onclick: () => toggleLike() });
  const meta = h('div', { class: 'meta' }, albumEl, titleEl, artistEl, likeBtn);

  const barMap = h('div', { class: 'bar-map' });
  const bar = h('div', { class: 'bar', role: 'slider', 'aria-label': 'Seek' }, barMap, h('div', { class: 'bar-fill' }), h('div', { class: 'bar-knob' }));
  const elapsed = h('span', {}, '0:00');
  const remaining = h('span', {}, '-0:00');
  const progress = h('div', { class: 'progress' }, bar, h('div', { class: 'times' }, elapsed, remaining));

  const shuffleBtn = ctl('ctl-small', icons.shuffle, 'Shuffle', () => run(source.toggleShuffle()));
  const prevBtn = ctl('ctl-skip', icons.prev, 'Previous', () => run(source.prev()));
  const playBtn = ctl('ctl-play', icons.play, 'Play', togglePlay);
  const nextBtn = ctl('ctl-skip', icons.next, 'Next', () => run(source.next()));
  const repeatBtn = ctl('ctl-small', icons.repeat, 'Repeat', () => run(source.cycleRepeat()));
  const controls = h('div', { class: 'controls' }, shuffleBtn, prevBtn, playBtn, nextBtn, repeatBtn);

  const np = h('section', { class: 'np' }, h('div', { class: 'np-inner' }, artWrap, h('div', { class: 'np-body' }, meta, progress, controls)));
  const lyricsEl = h('section', { class: 'lyrics' });

  const deviceIco = h('span', { class: 'device-ico' });
  const deviceName = h('span', { class: 'device-name' });
  const device = h('div', { class: 'chip device', hidden: true }, h('span', { class: 'chip-dot' }), deviceIco, deviceName);
  const status = h('div', { class: 'chip status', hidden: true }, h('span', { class: 'spinner-sm' }), 'Reconnecting');

  const dockBtn = (icon, label, onclick, key) => {
    const b = h('button', { 'aria-label': label, title: label, html: icon, onclick });
    if (key) watch(key, (v) => b.classList.toggle('is-off', !v));
    return b;
  };
  const dock = h('nav', { class: 'dock glass' },
    dockBtn(icons.layout, 'Switch view', cycleLayout),
    dockBtn(icons.lyrics, 'Lyrics on/off', () => settings.toggle('showLyrics'), 'showLyrics'),
    dockBtn(icons.image, 'Artwork on/off', () => settings.toggle('showArt'), 'showArt'),
    dockBtn(icons.expand, 'Immersive mode', () => setImmersive(true)),
    h('span', { class: 'dock-sep' }),
    dockBtn(icons.sliders, 'Settings', showSettings));
  const clock = h('div', { class: 'clock' });
  const topbar = h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, h('span', { class: 'mark', html: icons.logo }), h('span', { class: 'brand-name' }, 'Lyra')),
    device, status, h('div', { class: 'grow' }), dock, clock);

  const upImg = h('img', { alt: '' });
  const upTitle = h('div', { class: 'up-title' });
  const upArtist = h('div', { class: 'up-artist' });
  const upnext = h('aside', { class: 'upnext glass' }, upImg, h('div', { class: 'up-text' }, h('div', { class: 'eyebrow' }, 'Up next'), upTitle, upArtist));

  const idleTime = h('div', { class: 'idle-time' });
  const idleDate = h('div', { class: 'idle-date' });
  const idleHint = h('span', {}, 'Connecting to Spotify…');
  const idle = h('div', { class: 'idle' }, idleTime, idleDate, h('div', { class: 'idle-hint' }, h('span', { class: 'pulse' }), idleHint));

  const fatal = h('div', { class: 'fatal', hidden: true });
  const toasts = h('div', { class: 'toasts', 'aria-live': 'polite' });

  const ambient = h('div', { class: 'ambient' });
  const root = h('div', { class: 'player', 'data-idle': 'true' }, ambient, topbar, np, lyricsEl, upnext, idle, fatal, toasts);
  app.append(root);

  const lyrics = new LyricsView(lyricsEl, {
    onSeek: (ms) => run(source.seek(Math.max(0, ms - settings.values.syncOffset + 40))),
  });
  const viz = new Visualizer({ root, artWrap, art, onNotice: toast });

  // ── Playback state ────────────────────────────────────────────────────────
  offs.push(source.on('state', onState));
  offs.push(source.on('online', (ok) => {
    status.hidden = ok;
  }));
  offs.push(source.on('fatal', showFatal));
  offs.push(source.on('signedout', () => onSignedOut?.()));

  function onState(s) {
    if (s.isPlaying !== playing) {
      playing = Boolean(s.isPlaying);
      root.classList.toggle('is-playing', playing);
      playBtn.innerHTML = playing ? icons.pause : icons.play;
      playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      playBtn.classList.toggle('is-paused', !playing);
      syncWakeLock();
    }
    shuffleBtn.classList.toggle('is-on', Boolean(s.shuffle));
    repeatBtn.classList.toggle('is-on', Boolean(s.repeat && s.repeat !== 'off'));
    repeatBtn.innerHTML = s.repeat === 'track' ? icons.repeatOne : icons.repeat;
    const dis = s.disallows || {};
    prevBtn.classList.toggle('is-disabled', Boolean(dis.skipping_prev));
    nextBtn.classList.toggle('is-disabled', Boolean(dis.skipping_next));
    shuffleBtn.classList.toggle('is-disabled', Boolean(dis.toggling_shuffle));
    root.classList.toggle('no-seek', Boolean(dis.seeking));
    device.hidden = !s.device;
    if (s.device && deviceName.textContent !== s.device.name) {
      deviceName.textContent = s.device.name;
      deviceIco.innerHTML = deviceIcon(s.device.type);
    }
    idleHint.textContent = s.kind === 'ad' ? 'Advertisement' : 'Play something on Spotify';

    const changed = (s.uri || '') !== (track?.uri || '') || s.kind !== track?.kind;
    track = s;
    duration = s.durationMs || 0;
    if (changed) setTrack(s);
  }

  async function setTrack(s) {
    const mine = ++job;
    nextTrack = null;
    upnext.classList.remove('is-on');
    lastSec = -1;
    lastPf = -1;
    const live = s.kind === 'track' || s.kind === 'episode';
    root.dataset.idle = String(!live);
    if (!live) {
      lyrics.clear();
      lyrics.setMode('empty');
      return;
    }

    albumEl.textContent = s.album || '';
    titleEl.firstChild.textContent = s.title || '';
    artistEl.textContent = (s.artists || []).join(', ');
    replay(meta, 'is-swap');
    requestAnimationFrame(marquee);
    swapArt(s.art);
    barMap.style.backgroundImage = '';
    refreshLike(s, mine);

    if (s.art) {
      loadImage(s.art).then((img) => {
        if (mine !== job) return;
        const pal = extractPalette(img);
        if (pal) applyPalette(pal);
        bg.setArt(img);
      }).catch(() => {});
    } else {
      applyPalette(DEFAULT_PALETTE);
    }

    if (s.kind === 'episode') {
      lyrics.message('episode');
      return;
    }
    lyrics.loading();
    try {
      const result = source.lyricsFor ? source.lyricsFor(s) : await getLyrics(s);
      if (mine === job) {
        lyrics.set(result);
        barMap.style.backgroundImage = lyricsMap(result, s.durationMs);
      }
    } catch {
      if (mine === job) lyrics.message('error', { retry: () => setTrack(track) });
    }

    setTimeout(async () => {
      if (mine !== job || destroyed) return;
      try {
        nextTrack = (await source.peekNext?.()) || null;
      } catch {
        nextTrack = null;
      }
      if (mine !== job || !nextTrack) return;
      if (!source.demo) prefetchLyrics(nextTrack);
      upImg.src = nextTrack.art || '';
      upTitle.textContent = nextTrack.title || '';
      upArtist.textContent = (nextTrack.artists || []).join(', ');
    }, 2500);
  }

  let front = artA;
  let back = artB;
  let artUrl = null;
  function swapArt(url) {
    if (url === artUrl) return;
    artUrl = url;
    if (!url) {
      front.classList.remove('is-on');
      art.classList.add('is-empty');
      return;
    }
    const img = back;
    img.onload = () => {
      if (artUrl !== url) return;
      art.classList.remove('is-empty');
      img.classList.add('is-on');
      front.classList.remove('is-on');
      [front, back] = [img, front];
      replay(art, 'is-sheen');
    };
    img.src = url;
  }

  function marquee() {
    const span = titleEl.firstChild;
    titleEl.classList.remove('is-marquee');
    const over = span.scrollWidth - titleEl.clientWidth;
    if (over > 6) {
      titleEl.style.setProperty('--dx', `${-over - 18}px`);
      titleEl.style.setProperty('--mq', `${Math.max(9, over / 22 + 7)}s`);
      titleEl.classList.add('is-marquee');
    }
  }

  function applyPalette(pal) {
    bg.setPalette(pal);
    setPalette(pal);
  }

  // ── Frame loop ────────────────────────────────────────────────────────────
  // Older car computers can't keep up with blur + WebGL: measure once and back off.
  const perf = { last: 0, samples: [], start: performance.now() + 2500, done: EMBED || store.get(PERF_KEY, false) };
  function watchPerformance(now) {
    if (perf.done || document.hidden || !playing || now < perf.start) {
      perf.last = 0;
      return;
    }
    if (perf.last) perf.samples.push(now - perf.last);
    perf.last = now;
    if (perf.samples.length < 180) return;
    perf.done = true;
    store.set(PERF_KEY, true);
    const median = perf.samples.sort((a, b) => a - b)[90];
    if (median > 30 && !settings.get('lowPower')) {
      settings.set('lowPower', true);
      toast('Low power mode on for smoother lyrics');
    }
  }

  let lastGlow = -1;
  let lastPulse = -1;
  function applyEnergy(energy) {
    const v = settings.values;
    const glow = v.edgeGlow && !v.lowPower && playing ? 0.12 + energy * 0.88 : 0;
    if (Math.abs(glow - lastGlow) > 0.01) {
      lastGlow = glow;
      ambient.style.opacity = glow.toFixed(3);
    }
    const pulse = v.artPulse && !v.lowPower && playing ? 1 + energy * 0.035 : 1;
    if (Math.abs(pulse - lastPulse) > 0.0008) {
      lastPulse = pulse;
      art.style.setProperty('--pulse', pulse.toFixed(4));
    }
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    watchPerformance(now);
    const live = Boolean(track && duration);
    const pos = live ? source.position(now) : 0;
    const t = pos + settings.values.syncOffset;
    if (live) lyrics.update(t, now, pos / duration);
    applyEnergy(viz.frame(now, { playing: live && playing, vocal: live ? lyrics.vocalAt(t) : null, t }));
    if (!live || scrub) return;
    const pf = pos / duration;
    if (Math.abs(pf - lastPf) > 0.0004) {
      lastPf = pf;
      bar.style.setProperty('--pf', pf.toFixed(4));
    }
    const sec = Math.floor(pos / 1000);
    if (sec !== lastSec) {
      lastSec = sec;
      elapsed.textContent = fmtTime(pos);
      remaining.textContent = `-${fmtTime(duration - pos)}`;
      const left = duration - pos;
      upnext.classList.toggle('is-on', Boolean(settings.values.upNext && nextTrack && playing && left < 20000 && left > 1500 && track.repeat !== 'track'));
    }
  }
  raf = requestAnimationFrame(frame);

  // ── Seeking on the progress bar ───────────────────────────────────────────
  function moveScrub(e) {
    const r = bar.getBoundingClientRect();
    scrub.frac = clamp((e.clientX - r.left) / r.width, 0, 1);
    bar.style.setProperty('--pf', scrub.frac.toFixed(4));
    elapsed.textContent = fmtTime(scrub.frac * duration);
    remaining.textContent = `-${fmtTime(duration - scrub.frac * duration)}`;
  }
  bar.addEventListener('pointerdown', (e) => {
    if (!duration || root.classList.contains('no-seek')) return;
    bar.setPointerCapture(e.pointerId);
    scrub = { id: e.pointerId, frac: 0 };
    progress.classList.add('is-scrubbing');
    moveScrub(e);
  });
  bar.addEventListener('pointermove', (e) => {
    if (scrub?.id === e.pointerId) moveScrub(e);
  });
  bar.addEventListener('pointerup', (e) => {
    if (scrub?.id !== e.pointerId) return;
    const ms = scrub.frac * duration;
    scrub = null;
    lastSec = -1;
    progress.classList.remove('is-scrubbing');
    run(source.seek(ms));
  });
  bar.addEventListener('pointercancel', () => {
    scrub = null;
    progress.classList.remove('is-scrubbing');
  });

  // ── Artwork gestures: tap = play/pause, swipe = skip, double-tap = like ─────
  let drag = null;
  let lastTap = 0;
  let tapTimer = 0;
  const settle = () => {
    art.classList.remove('is-dragging');
    art.classList.add('is-settling');
    art.style.setProperty('--swipe', '0px');
    setTimeout(() => art.classList.remove('is-settling'), 450);
  };
  artWrap.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, moved: false };
  });
  artWrap.addEventListener('pointermove', (e) => {
    if (drag?.id !== e.pointerId) return;
    drag.dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(drag.dx) > 10 && Math.abs(drag.dx) > Math.abs(e.clientY - drag.y)) {
      drag.moved = true;
      art.classList.add('is-dragging');
      try {
        artWrap.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already released */
      }
    }
    if (drag.moved) art.style.setProperty('--swipe', `${drag.dx * 0.55}px`);
  });
  artWrap.addEventListener('pointerup', (e) => {
    if (drag?.id !== e.pointerId) return;
    const { dx, moved } = drag;
    drag = null;
    if (moved) {
      settle();
      if (Math.abs(dx) > 70) run(dx < 0 ? source.next() : source.prev());
      return;
    }
    const now = performance.now();
    if (now - lastTap < 300) {
      clearTimeout(tapTimer);
      lastTap = 0;
      replay(artHeart, 'is-burst');
      if (!liked) toggleLike(true);
      return;
    }
    lastTap = now;
    tapTimer = setTimeout(() => {
      lastTap = 0;
      togglePlay();
    }, 260);
  });
  artWrap.addEventListener('pointercancel', (e) => {
    if (drag?.id !== e.pointerId) return;
    drag = null;
    settle();
  });

  // ── Liked Songs ───────────────────────────────────────────────────────────
  let liked = false;
  async function refreshLike(s, mine) {
    liked = false;
    likeBtn.classList.remove('is-on');
    likeBtn.hidden = !source.isSaved || s.kind !== 'track' || s.isLocal;
    if (likeBtn.hidden) return;
    const saved = await source.isSaved(s).catch(() => null);
    if (mine !== job) return;
    liked = Boolean(saved);
    likeBtn.classList.toggle('is-on', liked);
  }

  async function toggleLike(force) {
    if (!track || track.kind !== 'track' || likeBtn.hidden) return;
    const want = force ?? !liked;
    liked = want;
    likeBtn.classList.toggle('is-on', want);
    if (want) replay(likeBtn, 'is-pop');
    try {
      await source.setSaved(track, want);
      toast(want ? 'Saved to Liked Songs' : 'Removed from Liked Songs');
    } catch (err) {
      liked = !want;
      likeBtn.classList.toggle('is-on', liked);
      toast(err?.status === 403 ? 'Sign in again to let Lyra save songs' : 'Couldn’t update your library');
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  function run(promise) {
    Promise.resolve(promise).catch((err) => toast(friendly(err)));
  }

  function togglePlay() {
    if (!track || track.kind === 'none') return;
    run(playing ? source.pause() : source.play());
  }

  function cycleLayout() {
    const order = LAYOUTS.map(([key]) => key);
    const next = order[(order.indexOf(settings.get('layout')) + 1) % order.length];
    settings.set('layout', next);
    if (!settings.get('showLyrics')) settings.set('showLyrics', true);
    toast(`${LAYOUT_NAMES[next]} view`);
  }

  function settingsOptions() {
    return {
      demo,
      profile: source.profile?.(),
      onSignOut: () => onExit?.(),
      onExitDemo: () => onExit?.(),
      onClearCache: clearLyricsCache,
    };
  }

  function showSettings() {
    openSettings(settingsOptions());
  }

  // ── Immersive mode: everything but the music fades away behind a slow zoom ──
  let immersive = false;
  let swallow = false;
  let downAt = null;
  let hinted = false;
  let lastActivity = performance.now();

  function setImmersive(on) {
    if (on === immersive || (on && settingsOpen())) return;
    immersive = on;
    root.classList.toggle('is-immersive', on);
    document.documentElement.dataset.immersive = String(on);
    lyrics.reanchor();
    if (on && !hinted) {
      hinted = true;
      setTimeout(() => immersive && toast('Tap anywhere to bring the controls back'), 1100);
    }
    if (!on) wake();
  }

  // While immersive, the first press only brings the UI back: it never seeks, skips or pauses.
  const onPressCapture = (e) => {
    downAt = { x: e.clientX, y: e.clientY };
    if (!immersive) return;
    swallow = true;
    e.stopPropagation();
  };
  const onReleaseCapture = (e) => {
    if (swallow) e.stopPropagation();
  };
  const onClickCapture = (e) => {
    if (swallow) {
      swallow = false;
      e.stopPropagation();
      e.preventDefault();
      setImmersive(false);
      return;
    }
    const moved = downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 12;
    if (moved || e.target.closest('button, a, input, select, .ly-line, .ly-gap, .art-wrap, .progress, .dock, .upnext, .fatal')) return;
    setImmersive(true);
  };
  root.addEventListener('pointerdown', onPressCapture, true);
  root.addEventListener('pointerup', onReleaseCapture, true);
  root.addEventListener('click', onClickCapture, true);

  const immersiveTimer = setInterval(() => {
    if (settings.values.autoImmersive && playing && !immersive && !settingsOpen() && performance.now() - lastActivity > 15000) {
      setImmersive(true);
    }
  }, 1000);

  // Pull the settings sheet out from the right edge of the screen.
  let edge = null;
  root.addEventListener('pointerdown', (e) => {
    if (immersive || settingsOpen() || e.clientX < innerWidth - 26) return;
    edge = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  const onEdgeMove = (e) => {
    if (edge?.id !== e.pointerId) return;
    const dx = e.clientX - edge.x;
    const dy = e.clientY - edge.y;
    if (dx < -10 && Math.abs(dx) > Math.abs(dy)) {
      openSettings({ ...settingsOptions(), pull: { pointerId: e.pointerId, startX: edge.x } });
      edge = null;
    } else if (Math.abs(dy) > 16 || dx > 10) {
      edge = null;
    }
  };
  const onEdgeUp = () => {
    edge = null;
  };
  addEventListener('pointermove', onEdgeMove);
  addEventListener('pointerup', onEdgeUp);

  function toast(text) {
    const t = h('div', { class: 'toast glass' }, text);
    toasts.append(t);
    while (toasts.children.length > 2) toasts.firstChild.remove();
    setTimeout(() => {
      t.classList.add('is-out');
      setTimeout(() => t.remove(), 450);
    }, 2200);
  }

  function showFatal({ title, body }) {
    fatal.replaceChildren(h('div', { class: 'fatal-card glass' },
      h('div', { class: 'fatal-icon', html: icons.music }),
      h('h2', {}, title),
      h('p', {}, body),
      h('div', { class: 'fatal-actions' },
        h('button', { class: 'btn btn-pearl btn-sm', onclick: () => {
          fatal.hidden = true;
          source.start();
        } }, 'Try again'),
        h('button', { class: 'btn btn-glass btn-sm', onclick: () => onExit?.() }, 'Sign out'))));
    fatal.hidden = false;
  }

  function nudge(delta) {
    settings.set('syncOffset', clamp(settings.get('syncOffset') + delta, -3000, 3000));
    toast(`Lyrics timing: ${fmtOffset(settings.get('syncOffset'))}`);
  }

  function toggleFullscreen() {
    const done = document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.();
    Promise.resolve(done).catch(() => {});
  }

  function onKey(e) {
    if (settingsOpen() || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea')) return;
    const pos = source.position();
    switch (e.key) {
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'ArrowRight': run(e.shiftKey ? source.next() : source.seek(Math.min(duration - 500, pos + 5000))); break;
      case 'ArrowLeft': run(e.shiftKey ? source.prev() : source.seek(Math.max(0, pos - 5000))); break;
      case 'l': case 'L': cycleLayout(); break;
      case 's': case 'S': showSettings(); break;
      case 'a': case 'A': settings.toggle('showArt'); break;
      case 'y': case 'Y': settings.toggle('showLyrics'); break;
      case '[': nudge(-100); break;
      case ']': nudge(100); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'i': case 'I': setImmersive(!immersive); break;
      case 'Escape': setImmersive(false); break;
      default:
    }
  }
  addEventListener('keydown', onKey);

  // Keep phone and tablet screens awake while music plays (no-op where unsupported).
  let wakeLock = null;
  function syncWakeLock() {
    const want = playing && !destroyed && !document.hidden && 'wakeLock' in navigator;
    if (want && !wakeLock) {
      wakeLock = navigator.wakeLock.request('screen').catch(() => null);
    } else if (!want && wakeLock) {
      wakeLock.then((lock) => lock?.release()).catch(() => {});
      wakeLock = null;
    }
  }
  const onVisibility = () => {
    if (!document.hidden) wakeLock = null; // the browser drops locks while hidden
    syncWakeLock();
  };
  document.addEventListener('visibilitychange', onVisibility);

  // ── Chrome: auto-hide, clock, relayout ───────────────────────────────────
  function wake() {
    lastActivity = performance.now();
    root.classList.add('is-awake');
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => root.classList.remove('is-awake'), 3800);
  }
  WAKE_EVENTS.forEach((ev) => addEventListener(ev, wake, { passive: true }));
  wake();

  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  function tick() {
    const now = new Date();
    const parts = timeFmt.formatToParts(now);
    const main = parts.filter((p) => p.type !== 'dayPeriod').map((p) => p.value).join('').trim();
    const period = parts.find((p) => p.type === 'dayPeriod')?.value || '';
    clock.replaceChildren(main, ...(period ? [h('small', {}, period)] : []));
    idleTime.textContent = main;
    idleDate.textContent = dateFmt.format(now);
  }
  tick();
  const clockTimer = setInterval(tick, 10000);

  const relayout = () => {
    lyrics.measure();
    marquee();
  };
  offs.push(settings.on('change', (key) => {
    if (!RELAYOUT.has(key)) return;
    requestAnimationFrame(relayout);
    setTimeout(relayout, 750);
  }));
  addEventListener('resize', marquee);
  addEventListener('lyra:fonts', relayout);
  document.fonts?.ready.then(() => !destroyed && relayout());

  if (welcome) setTimeout(() => toast('Connected. Enjoy the ride.'), 600);
  source.start();

  return {
    destroy() {
      destroyed = true;
      syncWakeLock();
      document.removeEventListener('visibilitychange', onVisibility);
      cancelAnimationFrame(raf);
      clearInterval(clockTimer);
      clearTimeout(wakeTimer);
      WAKE_EVENTS.forEach((ev) => removeEventListener(ev, wake));
      removeEventListener('keydown', onKey);
      removeEventListener('resize', marquee);
      removeEventListener('lyra:fonts', relayout);
      offs.forEach((off) => off());
      clearTimeout(tapTimer);
      clearInterval(immersiveTimer);
      removeEventListener('pointermove', onEdgeMove);
      removeEventListener('pointerup', onEdgeUp);
      delete document.documentElement.dataset.immersive;
      source.stop();
      lyrics.destroy();
      viz.destroy();
      closeSettings();
      root.remove();
    },
  };
}
