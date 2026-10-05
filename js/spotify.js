import { accessToken, AuthError } from './auth.js';
import { settings } from './settings.js';
import { clamp, Emitter } from './util.js';

const API = 'https://api.spotify.com/v1';
const RATES = { fast: 1500, balanced: 3000, saver: 6000 };
// Only these mean the session is really gone; anything else (e.g. a Spotify 5xx) is retried.
const SESSION_ENDED = new Set(['no_session', 'invalid_grant', 'invalid_client']);

export class ApiError extends Error {
  constructor(message, status, reason) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

export async function api(path, { method = 'GET', query, body } = {}, retry = true) {
  const url = new URL(API + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, v);
  const token = await accessToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && retry) {
    await accessToken(true);
    return api(path, { method, query, body }, false);
  }
  if (res.status === 202 || res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Some player endpoints answer with plain text.
  }
  if (!res.ok) {
    const err = new ApiError(data?.error?.message || `Spotify returned ${res.status}`, res.status, data?.error?.reason);
    if (res.status === 429) err.retryAfter = Number(res.headers.get('Retry-After')) || 5;
    throw err;
  }
  return data;
}

const biggest = (images) =>
  images?.length ? images.reduce((a, b) => ((b.width || 0) > (a.width || 0) ? b : a)).url : '';

export function normalizeItem(item) {
  if (item.type === 'episode') {
    return {
      kind: 'episode',
      id: item.id,
      uri: item.uri,
      title: item.name,
      artists: [item.show?.name || 'Podcast'],
      album: item.show?.name || '',
      art: biggest(item.images?.length ? item.images : item.show?.images),
      durationMs: item.duration_ms || 0,
    };
  }
  return {
    kind: 'track',
    id: item.id,
    uri: item.uri,
    title: item.name,
    artists: (item.artists || []).map((a) => a.name).filter(Boolean),
    album: item.album?.name || '',
    art: biggest(item.album?.images),
    durationMs: item.duration_ms || 0,
    isLocal: Boolean(item.is_local),
  };
}

function normalizePlayback(data, at) {
  if (!data) return { kind: 'none', isPlaying: false, progressMs: 0, durationMs: 0, at };
  const base = {
    isPlaying: Boolean(data.is_playing),
    progressMs: data.progress_ms || 0,
    at,
    device: data.device ? { name: data.device.name, type: data.device.type } : null,
    shuffle: Boolean(data.shuffle_state),
    repeat: data.repeat_state || 'off',
    disallows: data.actions?.disallows || {},
  };
  if (!data.item) return { ...base, kind: data.currently_playing_type === 'ad' ? 'ad' : 'none', durationMs: 0 };
  return { ...base, ...normalizeItem(data.item) };
}

function explain403(err) {
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('registered') || msg.includes('dashboard')) {
    return {
      title: 'This Spotify account isn’t on the list yet',
      body: 'Open your app in the Spotify developer dashboard → User Management, and add this account’s name and email. Apps in development mode allow up to 5 people.',
    };
  }
  if (msg.includes('premium')) {
    return {
      title: 'Spotify Premium required',
      body: 'Spotify requires the owner of a development app to have an active Premium subscription.',
    };
  }
  return { title: 'Spotify blocked the request', body: err.message };
}

// Polls Spotify for playback state and keeps a smooth local clock between polls.
export class SpotifySource extends Emitter {
  constructor() {
    super();
    this.state = null;
    this.timer = 0;
    this.seq = 0;
    this.running = false;
    this.failures = 0;
    this.blend = null;
    this.onVisibility = () => {
      if (!document.hidden && this.running) this.poll();
    };
  }

  start() {
    if (this.running) return;
    this.running = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    this.poll();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  schedule(ms) {
    clearTimeout(this.timer);
    if (this.running) this.timer = setTimeout(() => this.poll(), ms);
  }

  async poll() {
    clearTimeout(this.timer);
    if (!this.running || document.hidden) return;
    const seq = ++this.seq;
    const t0 = performance.now();
    try {
      const data = await api('/me/player', { query: { additional_types: 'episode' } });
      if (seq !== this.seq) return;
      // Spotify measured progress somewhere mid-request: split the round trip.
      this.ingest(data, (t0 + performance.now()) / 2);
      if (this.failures) this.emit('online', true);
      this.failures = 0;
      this.schedule(this.nextDelay());
    } catch (err) {
      if (seq !== this.seq) return;
      if (err instanceof AuthError && SESSION_ENDED.has(err.code)) {
        this.stop();
        this.emit('signedout', err);
      } else if (err.status === 429) {
        this.schedule((err.retryAfter || 5) * 1000);
      } else if (err.status === 403) {
        this.stop();
        this.emit('fatal', explain403(err));
      } else {
        this.failures++;
        this.emit('online', false);
        this.schedule(Math.min(15000, 1000 * 2 ** Math.min(this.failures, 4)));
      }
    }
  }

  nextDelay() {
    const base = RATES[settings.get('syncRate')] || RATES.balanced;
    const s = this.state;
    if (!s || s.kind === 'none') return Math.max(base, 5000);
    if (!s.isPlaying) return Math.max(base, 4000);
    const remaining = s.durationMs - this.position();
    // Catch the next song the moment it starts.
    if (remaining > 0 && remaining < base + 500) return Math.max(400, remaining + 350);
    return base;
  }

  ingest(data, at) {
    const next = normalizePlayback(data, at);
    const prev = this.state;
    this.blend = null;
    if (prev?.uri && prev.uri === next.uri && prev.isPlaying && next.isPlaying) {
      // Ease small corrections in instead of jumping, so lyrics never stutter.
      const drift = this.position(at) - next.progressMs;
      if (Math.abs(drift) < 1500) this.blend = { from: drift, start: at, dur: 900 };
    }
    this.state = next;
    this.emit('state', next);
  }

  position(now = performance.now()) {
    const s = this.state;
    if (!s) return 0;
    let p = s.progressMs + (s.isPlaying ? now - s.at : 0);
    const b = this.blend;
    if (b) {
      const k = 1 - (now - b.start) / b.dur;
      if (k > 0) p += b.from * k;
      else this.blend = null;
    }
    return clamp(p, 0, s.durationMs || Math.max(p, 0));
  }

  async control(request, optimistic, followUp = 400) {
    this.seq++; // drop polls already in flight — they predate this action
    if (optimistic && this.state) {
      optimistic(this.state);
      this.state.at = performance.now();
      this.blend = null;
      this.emit('state', this.state);
    }
    try {
      await request();
    } finally {
      this.schedule(followUp);
    }
  }

  play() {
    return this.control(() => api('/me/player/play', { method: 'PUT' }), (s) => {
      s.progressMs = this.position();
      s.isPlaying = true;
    });
  }

  pause() {
    return this.control(() => api('/me/player/pause', { method: 'PUT' }), (s) => {
      s.progressMs = this.position();
      s.isPlaying = false;
    });
  }

  next() {
    return this.control(() => api('/me/player/next', { method: 'POST' }), null, 350);
  }

  prev() {
    if (this.position() > 3500) return this.seek(0);
    return this.control(() => api('/me/player/previous', { method: 'POST' }), null, 350);
  }

  seek(ms) {
    const to = Math.max(0, Math.round(ms));
    return this.control(() => api('/me/player/seek', { method: 'PUT', query: { position_ms: to } }), (s) => {
      s.progressMs = to;
    }, 500);
  }

  toggleShuffle() {
    const on = !this.state?.shuffle;
    return this.control(() => api('/me/player/shuffle', { method: 'PUT', query: { state: on } }), (s) => {
      s.shuffle = on;
    });
  }

  cycleRepeat() {
    const order = ['off', 'context', 'track'];
    const next = order[(order.indexOf(this.state?.repeat || 'off') + 1) % order.length];
    return this.control(() => api('/me/player/repeat', { method: 'PUT', query: { state: next } }), (s) => {
      s.repeat = next;
    });
  }

  // Liked Songs. Spotify's Feb 2026 API uses /me/library with URIs; fall back to the
  // older /me/tracks endpoints if an app still runs on those.
  async isSaved(track) {
    try {
      const res = await api('/me/library/contains', { query: { uris: track.uri } });
      return Array.isArray(res) ? Boolean(res[0]) : null;
    } catch (err) {
      if (err.status !== 400 && err.status !== 404) return null;
      const res = await api('/me/tracks/contains', { query: { ids: track.id } }).catch(() => null);
      return Array.isArray(res) ? Boolean(res[0]) : null;
    }
  }

  async setSaved(track, saved) {
    const method = saved ? 'PUT' : 'DELETE';
    try {
      await api('/me/library', { method, body: { uris: [track.uri] } });
    } catch (err) {
      if (err.status !== 400 && err.status !== 404) throw err;
      await api('/me/tracks', { method, query: { ids: track.id } });
    }
  }

  async peekNext() {
    const queue = await api('/me/player/queue');
    const item = queue?.queue?.[0];
    return item ? normalizeItem(item) : null;
  }

  async profile() {
    const me = await api('/me');
    return me ? { name: me.display_name || me.id || 'Spotify', avatar: me.images?.[0]?.url || '' } : null;
  }
}
