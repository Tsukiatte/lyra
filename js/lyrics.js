import { store } from './util.js';

const API = 'https://lrclib.net/api';
const CLIENT = 'Lyra/1.0 (personal synced-lyrics viewer)';
const CACHE_KEY = 'lyra.lyrics.v1';
const CACHE_MAX = 60;
const NONE_TTL = 24 * 60 * 60 * 1000;

// Lines that are only music notes / dots mark an instrumental break.
const GAP_TEXT = /^[\s♪♫♬♩…·.\-–—]*$/u;
const MIN_GAP = 2600;
const LONG_LINE = 16000;

const memory = new Map();
const inflight = new Map();

export const trackKey = (t) => t.id || t.uri || `${t.title}|${t.artists?.[0] || ''}`;

export async function getLyrics(track, { signal } = {}) {
  const key = trackKey(track);
  if (memory.has(key)) return memory.get(key);
  const cached = readCache(key);
  if (cached) {
    const result = buildResult(cached, track.durationMs);
    memory.set(key, result);
    return result;
  }
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    const raw = await lookup(track, signal);
    writeCache(key, raw || { none: true });
    const result = buildResult(raw, track.durationMs);
    memory.set(key, result);
    return result;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

export function prefetchLyrics(track) {
  if (track?.kind === 'track') getLyrics(track).catch(() => {});
}

export function clearLyricsCache() {
  memory.clear();
  store.remove(CACHE_KEY);
}

// ─── Lookup ──────────────────────────────────────────────────────────────────

async function lookup(track, signal) {
  const artist = track.artists?.[0] || '';
  const seconds = Math.round((track.durationMs || 0) / 1000);

  let exact = null;
  try {
    exact = await request('/get', {
      track_name: track.title,
      artist_name: artist,
      album_name: track.album,
      duration: seconds || undefined,
    }, signal);
  } catch (err) {
    if (signal?.aborted) throw err; // otherwise fall through to search
  }
  if (usable(exact)) return pick(exact);

  const title = cleanTitle(track.title);
  const list = await request('/search', { track_name: title, artist_name: artist }, signal);
  let best = Array.isArray(list) ? choose(list, track) : null;
  if (best) return pick(best);
  try {
    // Free-text search is a best-effort last resort: LRCLIB often answers 503 when busy.
    const loose = await request('/search', { q: `${title} ${artist}` }, signal);
    best = Array.isArray(loose) ? choose(loose, track) : null;
  } catch (err) {
    if (signal?.aborted) throw err;
  }
  return best ? pick(best) : null;
}

async function request(path, params, signal) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  signal?.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const res = await fetch(url, { headers: { 'Lrclib-Client': CLIENT }, signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`LRCLIB returned ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const usable = (r) => Boolean(r && (r.syncedLyrics || r.plainLyrics || r.instrumental));

const pick = (r) => ({
  synced: r.syncedLyrics || null,
  plain: r.plainLyrics || null,
  instrumental: Boolean(r.instrumental),
  lyricsfile: r.hasWordSync ? r.lyricsfile : null,
});

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export function cleanTitle(title = '') {
  const cleaned = title
    .replace(/\s*[([](?:feat|ft|with|prod)\.?\s[^)\]]*[)\]]/gi, '')
    .replace(/\s*[([][^)\]]*(?:remaster|version|edit|mono|stereo|live|demo|deluxe|bonus|explicit|clean|anniversary)[^)\]]*[)\]]/gi, '')
    .replace(/\s+[-–—]\s+.*(?:remaster|version|edit|mono|stereo|live|demo|deluxe|bonus|from|feat|anniversary|recorded|session).*$/i, '')
    .trim();
  return cleaned || title;
}

export function choose(list, track) {
  const seconds = Math.round((track.durationMs || 0) / 1000);
  const wantTitle = norm(cleanTitle(track.title));
  const wantArtist = norm(track.artists?.[0]);
  let best = null;
  let bestScore = 0;
  for (const r of list) {
    if (!usable(r)) continue;
    const drift = seconds ? Math.abs((r.duration || 0) - seconds) : 0;
    if (seconds && drift > 8) continue;
    const title = norm(cleanTitle(r.trackName));
    const artist = norm(r.artistName);
    let score = r.syncedLyrics ? 50 : r.plainLyrics ? 10 : 5;
    score -= drift * 4;
    if (title === wantTitle) score += 30;
    else if (title && wantTitle && (title.includes(wantTitle) || wantTitle.includes(title))) score += 12;
    else score -= 25;
    if (artist && wantArtist && (artist.includes(wantArtist) || wantArtist.includes(artist))) score += 20;
    else score -= 15;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

export function buildResult(raw, durationMs = 0) {
  if (!raw || raw.none) return { kind: 'none' };
  for (const [text, parse] of [[raw.lyricsfile, parseLyricsfile], [raw.synced, parseLRC]]) {
    if (!text) continue;
    const lines = parse(text);
    if (lines.some((l) => !GAP_TEXT.test(l.text || ''))) {
      return { kind: 'synced', lines: buildTimeline(lines, durationMs), wordSynced: lines.some((l) => l.words?.length) };
    }
  }
  if (raw.plain) {
    const lines = raw.plain.split(/\r?\n/).map((t) => ({ text: t.trim() }));
    return { kind: 'plain', lines: lines.filter((l, i) => l.text || (i > 0 && lines[i - 1].text)) };
  }
  if (raw.instrumental) return { kind: 'instrumental' };
  return { kind: 'none' };
}

const TIME = /(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?/;
const toMs = (m) => (Number(m[1]) * 60 + Number(m[2])) * 1000 + (m[3] ? Number(m[3].padEnd(3, '0')) : 0);

export function parseLRC(text) {
  const out = [];
  let offset = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i);
    if (off) {
      offset = Number(off[1]);
      continue;
    }
    const lead = raw.match(/^\s*((?:\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]\s*)+)(.*)$/);
    if (!lead) continue;
    const times = [...lead[1].matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)].map(toMs);
    let body = lead[2];
    let words = null;
    if (/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/.test(body)) {
      words = parseWordTags(body);
      body = words.map((w) => w.text).join('');
    }
    for (const start of times) out.push({ start, text: body.trim(), words: times.length === 1 ? words : null });
  }
  // [offset:+n] means "show lyrics n ms sooner".
  if (offset) {
    for (const l of out) {
      l.start = Math.max(0, l.start - offset);
      l.words?.forEach((w) => {
        w.start = Math.max(0, w.start - offset);
        if (w.end != null) w.end = Math.max(0, w.end - offset);
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function parseWordTags(body) {
  const parts = body.split(/<(\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?)>/);
  const words = [];
  if (parts[0].trim()) words.push({ start: null, text: parts[0] });
  for (let i = 1; i < parts.length; i += 2) {
    const start = toMs(parts[i].match(TIME));
    const text = parts[i + 1] ?? '';
    if (text) words.push({ start, text });
    else if (words.length) words[words.length - 1].end = start; // trailing end tag
  }
  if (words[0] && words[0].start == null) words[0].start = words[1]?.start ?? 0;
  return words;
}

// LRCLIB's Lyricsfile is YAML; this reads just the subset it uses (lines → words).
export function parseLyricsfile(src) {
  const lines = [];
  let section = '';
  let line = null;
  let word = null;
  let lineIndent = -1;
  for (const raw of String(src).split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.search(/\S/);
    let s = raw.slice(indent);
    const item = s.startsWith('- ');
    if (indent === 0 && !item) {
      section = s.replace(/:.*$/, '');
      continue;
    }
    if (section !== 'lines') continue;
    if (item) s = s.slice(2);
    const m = s.match(/^([A-Za-z_]+):\s?(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    const keyIndent = item ? indent + 2 : indent;
    if (item && (lineIndent < 0 || keyIndent <= lineIndent)) {
      line = {};
      lines.push(line);
      lineIndent = keyIndent;
      word = null;
    } else if (item) {
      word = {};
      (line.words ||= []).push(word);
    } else if (keyIndent <= lineIndent) {
      word = null;
    }
    if (!line) continue;
    if (key === 'words') {
      line.words ||= [];
      continue;
    }
    (word && keyIndent > lineIndent ? word : line)[key] = scalar(value);
  }
  return lines
    .filter((l) => Number.isFinite(l.start_ms))
    .map((l) => ({
      start: l.start_ms,
      end: Number.isFinite(l.end_ms) ? l.end_ms : undefined,
      text: String(l.text ?? ''),
      words: l.words?.length
        ? l.words.filter((w) => Number.isFinite(w.start_ms)).map((w) => ({ start: w.start_ms, end: w.end_ms, text: String(w.text ?? '') }))
        : null,
    }));
}

function scalar(v) {
  const s = v.trim();
  if (s.startsWith("'")) return s.slice(1, s.endsWith("'") && s.length > 1 ? -1 : undefined).replace(/''/g, "'");
  if (s.startsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (s === 'true' || s === 'false') return s === 'true';
  if (s === 'null' || s === '~') return null;
  return s.replace(/\s+#.*$/, '');
}

// Turns parsed lines into a playable timeline: every lyric line gets an end time, and
// instrumental breaks become explicit "gap" entries (the animated dots).
export function buildTimeline(parsed, durationMs = 0) {
  const src = parsed.filter((l) => Number.isFinite(l.start)).sort((a, b) => a.start - b.start);
  const entries = [];
  for (let i = 0; i < src.length; i++) {
    const cur = src[i];
    const nextStart = i + 1 < src.length ? src[i + 1].start : durationMs > cur.start ? durationMs : cur.start + 6000;
    if (GAP_TEXT.test(cur.text || '')) {
      const prev = entries[entries.length - 1];
      if (prev?.gap) prev.end = nextStart;
      else entries.push({ gap: true, start: cur.start, end: nextStart });
      continue;
    }
    const end = Number.isFinite(cur.end) && cur.end > cur.start ? Math.min(cur.end, nextStart) : nextStart;
    entries.push({ start: cur.start, end, text: cur.text, words: cur.words?.length ? cur.words : null });
  }

  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const prev = out[out.length - 1];
    if (e.gap && e.end - e.start < MIN_GAP) {
      if (prev && !prev.gap) prev.end = e.end; // too short to animate: let the previous line hold
      continue;
    }
    out.push(e);
    const next = entries[i + 1];
    if (e.gap || !next || next.gap) continue;
    const hole = next.start - e.end;
    if (hole >= 4000) {
      out.push({ gap: true, start: e.end, end: next.start });
    } else if (next.start - e.start > LONG_LINE) {
      // A line "lasting" 16s+ almost always hides an unmarked instrumental.
      const sung = Math.min(8000, Math.max(3500, e.text.length * 90 + 1500));
      e.end = e.start + sung;
      out.push({ gap: true, start: e.end, end: next.start });
    } else {
      e.end = next.start;
    }
  }

  const first = out.findIndex((e) => !e.gap);
  if (first > 0) out[0].start = 0;
  else if (first === 0 && out[0].start >= MIN_GAP) out.unshift({ gap: true, start: 0, end: out[0].start });
  return out;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

function readCache(key) {
  const hit = store.get(CACHE_KEY, {})?.[key];
  if (!hit) return null;
  if (hit.none && Date.now() - (hit.at || 0) > NONE_TTL) return null;
  return hit;
}

function writeCache(key, raw) {
  const all = store.get(CACHE_KEY, {}) || {};
  all[key] = { ...raw, at: Date.now() };
  const keys = Object.keys(all);
  if (keys.length > CACHE_MAX) {
    keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, keys.length - CACHE_MAX).forEach((k) => delete all[k]);
  }
  store.set(CACHE_KEY, all);
}
