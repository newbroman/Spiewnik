# Śpiewnik

A mobile-first app for learning Polish through song lyrics, line by line. Each
Polish line sits on its own card with the English translation hidden — tap to
reveal, so you read, guess, then check yourself.

- **Reveal all** — read straight through with translations shown.
- **Focus mode** — dims everything but the line you're on, for stepping through.
- **Sample lesson** — original demo text (not a real song) so you can try the
  reader with no setup.

## How lyrics work (and copyright)

Song lyrics are copyrighted, so none are bundled in this app. They're fetched at
runtime from **Musixmatch**, a licensed lyrics provider, through a small
serverless function (`api/musixmatch.js`) that keeps your API key off the
client. Free Musixmatch plans return only ~30% of each lyric; full text needs a
paid plan. See **[SETUP.md](./SETUP.md)**.

## Run it locally

```bash
npm install
npm run dev
```

Then open the printed URL (usually http://localhost:5173). The reader and sample
lesson work immediately. For live search you need the lyrics backend — either
deploy to Vercel (below) or point dev at your deployed functions:

```bash
# optional: use your deployed /api during local dev
echo 'VITE_PROXY_TARGET=https://your-project.vercel.app' >> .env
npm run dev
```

## Deploy (Vercel)

1. Import this repo at [vercel.com](https://vercel.com) — it auto-detects Vite.
2. Add an environment variable **`MUSIXMATCH_API_KEY`** (from
   [developer.musixmatch.com](https://developer.musixmatch.com)).
3. Deploy. The app and the `/api/musixmatch` function share an origin, so search
   works with nothing to configure in the UI.

Full walkthrough and troubleshooting: **[SETUP.md](./SETUP.md)**.

## Project layout

```
api/musixmatch.js   serverless lyrics proxy (holds the API key)
src/App.jsx         the whole app (UI + study logic)
src/main.jsx        React entry point
vite.config.js      dev server + optional /api proxy
vercel.json         SPA routing (everything but /api → index.html)
```

## Make it a phone app

Wrap the built app with [Capacitor](https://capacitorjs.com) for an installable
Android/iOS build. Native builds aren't subject to CORS, so the proxy becomes
optional there.
