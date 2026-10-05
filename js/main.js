// Spotify only accepts loopback redirect URIs as 127.0.0.1, never "localhost".
if (location.hostname === 'localhost') location.replace(location.href.replace('//localhost', '//127.0.0.1'));

import * as auth from './auth.js';
import { Background } from './background.js';
import { DemoSource } from './demo.js';
import { mountPlayer } from './player.js';
import { renderConnect, renderPhoneHandoff, renderPhonePair, renderSetup } from './screens.js';
import { settings } from './settings.js';
import { SpotifySource } from './spotify.js';

const root = document.documentElement;
const app = document.getElementById('app');

if (/\bTesla\b/i.test(navigator.userAgent)) root.dataset.tesla = 'true';

// Every setting is mirrored onto <html>: booleans/strings as data-*, numbers as --s-* variables.
function applySettings() {
  for (const [key, value] of Object.entries(settings.values)) {
    if (typeof value === 'number') root.style.setProperty(`--s-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, String(value));
    else root.dataset[key] = String(value);
  }
}
applySettings();
settings.on('change', applySettings);

const bg = new Background(document.getElementById('bg'));

let teardown = () => {};
function show(render) {
  teardown();
  teardown = render() || (() => {});
}

function route(notice = '') {
  if (!auth.clientId()) {
    return show(() => renderSetup(app, { onSaved: () => route(), onDemo: startDemo }));
  }
  if (auth.isSignedIn()) return startSpotify();
  show(() => renderConnect(app, {
    notice,
    onDemo: startDemo,
    onError: (message) => route(message),
    onPaired: ({ rt, at, ttl }) => {
      auth.saveTokens({ refresh_token: rt, access_token: at, expires_at: Date.now() + Math.max(0, (ttl || 0) - 5000) });
      startSpotify({ welcome: true });
    },
  }));
}

function startSpotify({ welcome = false } = {}) {
  show(() => {
    const player = mountPlayer(app, {
      source: new SpotifySource(),
      bg,
      welcome,
      onExit: () => {
        auth.signOut();
        route();
      },
      onSignedOut: () => {
        auth.signOut();
        route('Your Spotify session ended. Please sign in again.');
      },
    });
    return () => player.destroy();
  });
}

function startDemo() {
  show(() => {
    const player = mountPlayer(app, {
      source: new DemoSource(),
      bg,
      demo: true,
      onExit: () => {
        if (new URLSearchParams(location.search).has('demo')) history.replaceState(null, '', location.pathname);
        route();
      },
    });
    return () => player.destroy();
  });
}

async function boot() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('pair')) {
    // Phone side of QR pairing.
    if (hash.get('cid')) auth.setClientId(hash.get('cid'));
    const key = hash.get('pair');
    history.replaceState(null, '', location.pathname);
    return show(() => renderPhonePair(app, { key }));
  }

  let notice = '';
  try {
    const done = await auth.completeLogin();
    if (done?.pending?.pairKey) {
      return show(() => renderPhoneHandoff(app, { tokens: done.tokens, pairKey: done.pending.pairKey }));
    }
    if (done) auth.saveTokens(done.tokens);
  } catch (err) {
    notice = err.message;
  }

  if (new URLSearchParams(location.search).has('demo')) return startDemo();
  route(notice);
}

// A pairing link opened in a tab that's already on Lyra only changes the hash.
addEventListener('hashchange', () => {
  if (new URLSearchParams(location.hash.slice(1)).has('pair')) location.reload();
});

boot();
