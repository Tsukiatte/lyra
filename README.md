# Lyra

Beautiful, perfectly synced lyrics for whatever's playing on Spotify, built for the car screen
(and anything else with a browser).

- **Synced karaoke lyrics**: words light up as they're sung, with a cascading scroll, depth blur and
  breathing dots during instrumental breaks. Tap any line to jump to it.
- **Seven styles**: Lumière (frosted glass), Noir (editorial Bodoni), Aurum (champagne gold),
  Chrome (liquid metal), Frost (daylight glass), Neon (midnight glow) and Riviera (cream and
  navy). Compare them live on `styles.html`, or switch in Settings → Style.
- **Visualizer**: Halo (bars hugging the artwork), Bars or Wave, plus an artwork pulse and an
  ambient edge glow. It pulses with the singing (word and line timing from the synced lyrics), or
  with real audio from the microphone where the browser allows it. Browsers can't access
  Spotify's audio stream directly.
- **Vinyl mode**: the cover becomes a spinning record that stops when you pause.
- **Gestures**: tap the artwork to play/pause, swipe it to skip, double-tap to save to Liked Songs.
- **Lyrics map**: the progress bar shows where the singing is.
- **Day & night styles**: switch automatically at 7 am and 7 pm.
- **Immersive mode**: tap empty space (or the dock button) and the logo, dock, clock and
  controls fade away behind a slow zoom; tap anywhere to bring them back. Optional auto mode.
- **Physical settings sheet**: pull it out from the right edge, fling it closed; it opens on a
  spring while the app recedes, and scrolling glides with rubber-band ends.
- **Four views**: Split, Lyrics, Cover and Stage, all switchable from the dock.
- **Living backgrounds** tinted by the album art: Aurora (WebGL), Artwork, Tint or pure Black.
- **Everything is a toggle**: artwork, reflection, controls, clock, text size, typeface, alignment,
  glow, blur, timing offset, accent color, motion, low power mode and more.
- **Scan-to-connect**: the car shows a QR code; you sign in on your phone and the session is handed
  to the car over an end-to-end encrypted link. No typing passwords on the touchscreen.
- **Fits every screen**: from a phone to a 17″ car display, down to a short browser window.
  `tesla.html` shows the live app at the exact size a Tesla's browser gives a page (1255 × 758
  on software 2026.26 and later), with switches for car, view, style and visualizer.
- **No server, no build step**: plain HTML/CSS/JS you can host anywhere for free.

Lyrics come from [LRCLIB](https://lrclib.net), a free community-made library. Playback data comes
from the Spotify Web API.

## 1. Create a Spotify app (5 minutes)

1. Go to <https://developer.spotify.com/dashboard> and sign in. Spotify requires the app owner to
   have **Spotify Premium**.
2. **Create app**. Any name and description work. Under *Redirect URIs* add both:
   - `http://127.0.0.1:5173/` (for running it on your computer)
   - your hosted address, e.g. `https://YOUR-GITHUB-NAME.github.io/lyra/`
3. Tick **Web API**, accept the terms, and save.
4. Open the app's **Settings** and copy the **Client ID**. (You never need the Client Secret.)
5. Paste the Client ID into [`config.js`](config.js):

   ```js
   export const SPOTIFY_CLIENT_ID = 'your-client-id-here';
   ```

**Friends and family:** apps in Spotify's development mode work for up to **5 people**. Add each
person's Spotify name and email under your app → *User Management*.

## 2. Try it on your computer

```bash
npm run dev
```

Open <http://127.0.0.1:5173> (use `127.0.0.1`, not `localhost`, because Spotify rejects
`localhost` redirects). Start music in any Spotify app, then sign in. `?demo` (or the
**Try the demo** button) plays two built-in songs without Spotify.

## 3. Put it online (free, GitHub Pages)

Create a public GitHub repository named `lyra`, push these files, then enable
*Settings → Pages → Deploy from branch → main / root*. Your address becomes
`https://YOUR-GITHUB-NAME.github.io/lyra/`. Make sure that exact address (with the trailing slash)
is in your Spotify app's Redirect URIs.

## 4. Use it in the car

1. Open the Tesla browser and go to your address. Add it to favorites so it's one tap away.
2. Scan the QR code with your phone and sign in with Spotify. The car connects by itself.
3. Play music from the car's Spotify app. Lyrics follow along.

The car stays signed in until you press *Disconnect* in Settings. If lyrics run slightly ahead or
behind for your setup, nudge **Settings → Lyrics → Timing** (or press `[` / `]` on a keyboard).
On older cars, **Low power mode** keeps everything smooth. Lyra turns it on by itself once if it
detects a slow frame rate.

> Please keep your eyes on the road. Lyra is for passengers and quick glances. Some regions limit
> the browser while driving.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| Space | Play / pause |
| ← / → | Seek 5 seconds (Shift: previous / next song) |
| L | Switch view |
| A / Y | Toggle artwork / lyrics |
| [ / ] | Lyrics timing −/+ 0.1 s |
| S | Settings |
| I | Immersive mode |
| F | Fullscreen |

## Troubleshooting

- **"This Spotify account isn't on the list yet"**: add the account under *User Management* in the
  Spotify dashboard.
- **"Spotify Premium required"**: the Spotify developer app's owner needs an active Premium plan.
- **"INVALID_CLIENT: Invalid redirect URI"**: the address in the browser must exactly match one of
  the Redirect URIs in your Spotify app, including `https` and the trailing `/`.
- **"No lyrics for this one"**: LRCLIB doesn't have that song yet. Anyone can contribute synced
  lyrics at lrclib.net.
- **Nothing playing?** Lyra only shows what Spotify reports. Start playback first, and make sure a
  private session isn't on.

## Privacy

Everything Lyra remembers (sign-in, settings, cached lyrics) stays in the browser's local storage.
Phone pairing uses the public [ntfy.sh](https://ntfy.sh) relay. The message is AES-GCM encrypted
with a random key that only exists inside the QR code, so the relay sees ciphertext only. Set
`PAIRING_RELAY = ''` in `config.js` to turn pairing off.

## Development

```bash
npm test      # lyric parsing and timing tests
```

Open <http://127.0.0.1:5173/tests/mock-spotify.html> to run the real Spotify code path against a
simulated account (real lyrics and artwork, fake playback). In the console, `mock.idle()`,
`mock.fail(403)`, `mock.fail(500)` and `mock.ok()` exercise the idle and error states.

The app is plain ES modules in [`js/`](js). [`css/app.css`](css/app.css) defines the layout and
design tokens; [`css/themes.css`](css/themes.css) restyles them per style, and
[`js/themes.js`](js/themes.js) lists each style's fonts, accent rule and preview. Every setting is
mirrored onto `<html>` as `data-*` attributes and `--s-*` CSS variables, so most visual toggles
are pure CSS. `?theme=noir` switches style from a link.
