// ─── Lyra configuration ──────────────────────────────────────────────────────
//
// Paste your Spotify app's Client ID between the quotes. Find it at
// https://developer.spotify.com/dashboard → your app → Settings.
//
// The Client ID is not a secret: Lyra signs in with the PKCE flow, which runs
// entirely in the browser and never needs the Client Secret.
export const SPOTIFY_CLIENT_ID = '';

// Relay used for "scan with your phone" sign-in. The phone encrypts the session
// with a key that only exists inside the QR code, so the relay only ever sees
// ciphertext. Set to '' to turn phone pairing off.
export const PAIRING_RELAY = 'https://ntfy.sh';
