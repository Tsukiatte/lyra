// "Scan with your phone" sign-in.
//
// The car shows a QR code containing a random 256-bit key. The phone signs in to
// Spotify, encrypts the session with that key (AES-GCM) and posts the ciphertext
// to a public relay topic derived from the key. The car is subscribed to that
// topic, decrypts the message and is signed in. The relay never sees the key.

import { PAIRING_RELAY, SPOTIFY_CLIENT_ID } from '../config.js';
import { clientId, redirectUri } from './auth.js';
import { b64url, b64urlDecode, randomBytes, sha256 } from './util.js';

export const pairingEnabled = () => Boolean(PAIRING_RELAY);

async function topicFor(key) {
  return `lyra-${b64url(await sha256(`lyra-pair:${key}`)).slice(0, 32)}`;
}

async function aesKey(key, usage) {
  return crypto.subtle.importKey('raw', b64urlDecode(key), 'AES-GCM', false, [usage]);
}

export async function seal(key, payload) {
  const iv = randomBytes(12);
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(key, 'encrypt'), data);
  return `lyra1.${b64url(iv)}.${b64url(new Uint8Array(ct))}`;
}

export async function unseal(key, message) {
  const [version, iv, ct] = String(message).split('.');
  if (version !== 'lyra1' || !iv || !ct) throw new Error('Not a Lyra message');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64urlDecode(iv) }, await aesKey(key, 'decrypt'), b64urlDecode(ct));
  return JSON.parse(new TextDecoder().decode(plain));
}

// Car side.
export async function createPairing() {
  const key = b64url(randomBytes(32));
  const params = new URLSearchParams({ pair: key });
  if (!SPOTIFY_CLIENT_ID.trim()) params.set('cid', clientId());
  return { key, topic: await topicFor(key), url: `${redirectUri()}#${params}` };
}

export function waitForPhone(session, onSession) {
  const since = Math.floor(Date.now() / 1000) - 10;
  const source = new EventSource(`${PAIRING_RELAY}/${session.topic}/sse?since=${since}`);
  let done = false;
  source.onmessage = async (event) => {
    if (done) return;
    try {
      const msg = JSON.parse(event.data);
      if (msg.event && msg.event !== 'message') return;
      const payload = await unseal(session.key, msg.message);
      done = true;
      source.close();
      onSession(payload);
    } catch {
      // Anything we can't decrypt isn't for us.
    }
  };
  return () => source.close();
}

// Phone side.
export async function sendToCar(key, payload) {
  const res = await fetch(`${PAIRING_RELAY}/${await topicFor(key)}`, { method: 'POST', body: await seal(key, payload) });
  if (!res.ok) throw new Error(`Relay error (${res.status})`);
}
