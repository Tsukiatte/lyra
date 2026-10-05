import { SPOTIFY_CLIENT_ID } from '../config.js';
import { b64url, randomBytes, sha256, store } from './util.js';

const SCOPES = ['user-read-playback-state', 'user-read-currently-playing', 'user-modify-playback-state'];
const K_TOKENS = 'lyra.tokens';
const K_PENDING = 'lyra.pkce';
const K_CLIENT = 'lyra.clientId';

export class AuthError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

export const clientId = () => SPOTIFY_CLIENT_ID.trim() || store.get(K_CLIENT, '');
export const setClientId = (id) => store.set(K_CLIENT, String(id).trim());

// Spotify matches redirect URIs exactly, so always use the app's folder URL (with trailing slash).
export const redirectUri = () => location.origin + location.pathname.replace(/[^/]*$/, '');

let tokens = store.get(K_TOKENS, null);

// Keep tabs in sync: Spotify rotates refresh tokens, so a stale copy would eventually fail.
addEventListener('storage', (e) => {
  if (e.key === K_TOKENS) tokens = store.get(K_TOKENS, null);
});

export const isSignedIn = () => Boolean(tokens?.refresh_token);

export function saveTokens(next) {
  tokens = next;
  store.set(K_TOKENS, next);
}

export function signOut() {
  tokens = null;
  store.remove(K_TOKENS);
}

export async function beginLogin(extra = {}) {
  const id = clientId();
  if (!id) throw new AuthError('Add your Spotify Client ID first.', 'no_client');
  const verifier = b64url(randomBytes(64));
  const challenge = b64url(await sha256(verifier));
  const state = b64url(randomBytes(16));
  store.set(K_PENDING, { verifier, state, at: Date.now(), ...extra });
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: id,
    scope: SCOPES.join(' '),
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  location.assign(`https://accounts.spotify.com/authorize?${query}`);
}

// Handles the ?code= redirect back from Spotify. Returns null when this isn't a callback.
export async function completeLogin() {
  const query = new URLSearchParams(location.search);
  const code = query.get('code');
  const error = query.get('error');
  if (!code && !error) return null;

  history.replaceState(null, '', redirectUri());
  const pending = store.get(K_PENDING, null);
  store.remove(K_PENDING);

  if (error) {
    throw new AuthError(error === 'access_denied' ? 'Spotify sign-in was cancelled.' : `Spotify sign-in failed (${error}).`, error);
  }
  if (!pending || pending.state !== query.get('state')) {
    throw new AuthError('That sign-in link expired. Please try again.', 'state_mismatch');
  }
  const next = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: pending.verifier,
  });
  return { tokens: next, pending };
}

async function tokenRequest(params) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId(), ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError(body.error_description || body.error || `Spotify token error (${res.status})`, body.error);
  return {
    access_token: body.access_token,
    refresh_token: body.refresh_token || params.refresh_token,
    expires_at: Date.now() + (body.expires_in || 3600) * 1000,
  };
}

let refreshing = null;

export async function accessToken(force = false) {
  if (!tokens?.refresh_token) throw new AuthError('Not signed in.', 'no_session');
  if (!force && tokens.access_token && tokens.expires_at - 60_000 > Date.now()) return tokens.access_token;
  refreshing ||= tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token })
    .then((next) => {
      saveTokens(next);
      return next.access_token;
    })
    .catch((err) => {
      if (err instanceof AuthError && (err.code === 'invalid_grant' || err.code === 'invalid_client')) signOut();
      throw err;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}
