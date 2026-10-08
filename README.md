# Śpiewnik

A mobile-first React app for learning Polish through song lyrics, line by line: each Polish line sits on its own card with the English translation hidden, so you read, guess, then check yourself.

This is a Vite/React app deployed to Vercel (see below), not a static GitHub Pages site, so there is no Pages link.

## Features

- Line-by-line reader: tap a line to reveal or hide its English translation.
- **Reveal all** / **Hide translations** toggle to read straight through.
- **Focus mode** dims everything except the line you are on, for stepping through a song.
- Search for songs by title or artist; lyrics and English translations are fetched live from Musixmatch.
- A notice is shown when the lyric returned is only a partial preview.
- **Sample lesson**: original demo text (not a real song) so the reader can be tried with no backend.
- Settings tab with an optional proxy URL override (normally left blank).

## Using it

Open the deployed Vercel URL in any modern browser. It is designed for phone-sized screens. There is no service worker or manifest, so it is not an installable PWA and does not work offline. The sample lesson needs no backend, but song search needs the `/api/musixmatch` function and its API key to be configured.

## Lyrics and copyright

Song lyrics are copyrighted, so none are bundled. They are fetched at runtime from Musixmatch, a licensed lyrics provider, through a small serverless function (`api/musixmatch.js`) that keeps the API key off the client and avoids browser CORS limits. The function only allows `track.search`, `track.lyrics.get`, `track.lyrics.translation.get` and `matcher.lyrics.get`. Free Musixmatch plans return only about 30% of each lyric; full text needs a paid plan. See [SETUP.md](./SETUP.md) for the full walkthrough and troubleshooting.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/App.jsx` | The whole app: UI, styles, search, reader and study logic, sample lesson |
| `src/main.jsx` | React entry point |
| `src/index.css` | Minimal global styles |
| `index.html` | Vite HTML entry |
| `api/musixmatch.js` | Vercel serverless lyrics proxy (holds the API key) |
| `vercel.json` | SPA routing: everything except `/api/` rewrites to `index.html` |
| `vite.config.js` | Dev server, with an optional `/api` proxy via `VITE_PROXY_TARGET` |
| `.env.example` | Template for environment variables |
| `SETUP.md` | Musixmatch key, Vercel deployment and troubleshooting |

## Development

```bash
npm install
npm run dev      # dev server, usually http://localhost:5173
npm run build    # production build into dist/
npm run preview  # serve the production build locally
```

The reader and sample lesson work immediately. For live search locally, copy `.env.example` to `.env` and set:

- `MUSIXMATCH_API_KEY`: your key from developer.musixmatch.com. Used only by the serverless function (for example under `vercel dev`), never exposed to the browser.
- `VITE_PROXY_TARGET`: optional, local dev only. Your deployed Vercel URL (for example `https://your-project.vercel.app`); `npm run dev` then proxies `/api` to it, so no local backend is needed.

Do not commit `.env`; it is git-ignored.

## Deployment (Vercel)

1. Import the repo at vercel.com; it detects Vite automatically.
2. Add the environment variable `MUSIXMATCH_API_KEY` in the project settings.
3. Deploy (or redeploy after adding the variable). The app and `/api/musixmatch` share an origin, so no further configuration is needed in the app.

## Notes

- To test the function directly: `/api/musixmatch?path=track.search&q=hello&page_size=3` on the deployed site should return JSON.
- The author's idea for a phone app is to wrap the built app with Capacitor; native builds are not subject to CORS, so the proxy would become optional there. This is not set up in the repo.
- A "paste your own lyrics" mode is noted in SETUP.md as a possible small addition; the reader already takes a `{ lines: [{ pl, en }] }` shape.

Built by Martin Hollingham.
