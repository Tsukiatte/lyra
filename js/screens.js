import { beginLogin, redirectUri, setClientId } from './auth.js';
import { icons } from './icons.js';
import { createPairing, pairingEnabled, sendToCar, waitForPhone } from './pairing.js';
import { h } from './util.js';

const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
let qrLib = null;

function loadQR() {
  qrLib ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = QR_LIB;
    s.onload = () => resolve(window.qrcode);
    s.onerror = () => {
      qrLib = null;
      reject(new Error('QR library failed to load'));
    };
    document.head.append(s);
  });
  return qrLib;
}

// A QR code with round modules and soft finder patterns.
async function qrSvg(text) {
  const qrcode = await loadQR();
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const m = 1;
  const finder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  let dots = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c) && !finder(r, c)) dots += `<circle cx="${c + m + 0.5}" cy="${r + m + 0.5}" r=".44"/>`;
    }
  }
  const eye = (x, y) =>
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="1.9" fill="none" stroke="currentColor" stroke-width="1"/>` +
    `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="1"/>`;
  const size = n + m * 2;
  return `<svg viewBox="0 0 ${size} ${size}" fill="currentColor" role="img" aria-label="QR code to connect your phone">${dots}${eye(m, m)}${eye(m + n - 7, m)}${eye(m, m + n - 7)}</svg>`;
}

const isLoopback = () => ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
const mark = (cls = '') => h('span', { class: `mark ${cls}`, html: icons.star });

// ── Car: connect screen ─────────────────────────────────────────────────────
export function renderConnect(app, { notice, onDemo, onPaired, onError }) {
  const qrTile = h('div', { class: 'qr-tile is-loading' });
  const statusText = h('span', {}, 'Waiting for your phone…');
  const localLink = h('a', { class: 'local-link', target: '_blank', rel: 'noopener', hidden: true }, 'Open pairing link in a new tab');

  const pairCard = h('div', { class: 'connect-card glass' },
    qrTile,
    h('div', { class: 'connect-steps' },
      h('div', { class: 'eyebrow' }, 'Scan to connect'),
      h('ol', {},
        h('li', {}, 'Point your phone camera at the code'),
        h('li', {}, 'Sign in with Spotify on your phone'),
        h('li', {}, 'Your car connects on its own')),
      h('div', { class: 'pair-status' }, h('span', { class: 'pulse' }), statusText),
      localLink));

  const view = h('main', { class: 'screen connect' },
    h('div', { class: 'hero' },
      mark('mark-xl'),
      h('h1', { class: 'wordmark' }, 'Lyra'),
      h('p', { class: 'tagline' }, 'Lyrics in perfect time. Made for the drive.')),
    pairingEnabled() ? pairCard : null,
    h('div', { class: 'connect-actions' },
      h('button', { class: 'btn btn-pearl', onclick: () => beginLogin().catch((e) => onError?.(e.message)) }, pairingEnabled() ? 'Sign in on this screen' : 'Sign in with Spotify'),
      h('button', { class: 'btn btn-glass', onclick: onDemo }, 'Try the demo')),
    notice ? h('div', { class: 'notice' }, notice) : null,
    h('footer', { class: 'fineprint' }, 'Works with Spotify Premium · Lyrics from LRCLIB'));
  app.replaceChildren(view);

  let stop = () => {};
  let cancelled = false;
  if (pairingEnabled()) {
    createPairing()
      .then(async (session) => {
        qrTile.innerHTML = await qrSvg(session.url);
        qrTile.classList.remove('is-loading');
        if (cancelled) return;
        if (isLoopback()) {
          localLink.href = session.url;
          localLink.hidden = false;
          statusText.textContent = 'Local preview: phones can’t reach this address yet';
        }
        stop = waitForPhone(session, (payload) => {
          statusText.textContent = 'Connected!';
          onPaired(payload);
        });
      })
      .catch(() => {
        qrTile.classList.remove('is-loading');
        qrTile.classList.add('is-failed');
        statusText.textContent = 'Phone pairing is unavailable. Sign in on this screen instead.';
      });
  }
  return () => {
    cancelled = true;
    stop();
  };
}

// ── Phone: opened from the QR code ──────────────────────────────────────────
export function renderPhonePair(app, { key }) {
  const error = h('div', { class: 'notice', hidden: true });
  app.replaceChildren(h('main', { class: 'screen phone' },
    h('div', { class: 'card glass' },
      mark('mark-lg'),
      h('h1', {}, 'Connect your car'),
      h('p', {}, 'Sign in with Spotify on this phone. Lyra hands the session to your car over an encrypted link. Nothing stays on this phone.'),
      h('button', {
        class: 'btn btn-pearl btn-wide',
        onclick: () => beginLogin({ pairKey: key }).catch((e) => {
          error.textContent = e.message;
          error.hidden = false;
        }),
      }, 'Continue with Spotify'),
      error)));
}

export function renderPhoneHandoff(app, { tokens, pairKey }) {
  const card = h('div', { class: 'card glass' });
  app.replaceChildren(h('main', { class: 'screen phone' }, card));
  const send = async () => {
    card.replaceChildren(h('div', { class: 'spinner' }), h('h1', {}, 'Connecting your car…'), h('p', {}, 'Keep this page open for a moment.'));
    try {
      await sendToCar(pairKey, {
        rt: tokens.refresh_token,
        at: tokens.access_token,
        ttl: Math.max(0, tokens.expires_at - Date.now()),
      });
      card.replaceChildren(
        h('div', { class: 'big-check', html: icons.check }),
        h('h1', {}, 'You’re all set'),
        h('p', {}, 'Look at your car’s screen. Your lyrics are ready. You can close this page.'));
    } catch {
      card.replaceChildren(
        h('h1', {}, 'Couldn’t reach your car'),
        h('p', {}, 'Check your phone’s connection, then try again.'),
        h('button', { class: 'btn btn-pearl btn-wide', onclick: send }, 'Try again'));
    }
  };
  send();
}

// ── First run: no Client ID configured ──────────────────────────────────────
export function renderSetup(app, { onSaved, onDemo }) {
  const uri = redirectUri();
  const input = h('input', { class: 'field', placeholder: 'Paste your Client ID', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Spotify Client ID' });
  const error = h('div', { class: 'field-error', hidden: true }, 'That doesn’t look like a Client ID. It’s 32 letters and numbers.');
  const copyBtn = h('button', { class: 'icon-btn', 'aria-label': 'Copy redirect URI', html: icons.copy });
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(uri);
      copyBtn.innerHTML = icons.check;
      setTimeout(() => (copyBtn.innerHTML = icons.copy), 1500);
    } catch {
      /* clipboard blocked: the URI is selectable */
    }
  });
  const save = () => {
    const id = input.value.trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) {
      error.hidden = false;
      return;
    }
    setClientId(id);
    onSaved();
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && save());

  app.replaceChildren(h('main', { class: 'screen setup' },
    h('div', { class: 'hero' }, mark('mark-lg'), h('h1', { class: 'wordmark wordmark-sm' }, 'Lyra')),
    h('div', { class: 'card card-wide glass' },
      h('h1', {}, 'Connect your Spotify app'),
      h('ol', { class: 'setup-steps' },
        h('li', {}, 'Open ', h('a', { href: 'https://developer.spotify.com/dashboard', target: '_blank', rel: 'noopener' }, 'developer.spotify.com/dashboard'), ' and create an app. Tick ', h('b', {}, 'Web API'), '.'),
        h('li', {}, 'Add this exact Redirect URI:', h('div', { class: 'copy-row' }, h('code', { class: 'uri' }, uri), copyBtn)),
        h('li', {}, 'Paste the app’s Client ID here:')),
      input,
      error,
      h('button', { class: 'btn btn-pearl btn-wide', onclick: save }, 'Save and continue'),
      h('button', { class: 'btn btn-glass btn-wide', onclick: onDemo }, 'Try the demo first'))));
  input.focus();
}
