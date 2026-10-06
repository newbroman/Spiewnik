# Setup & deployment

The app talks to its own `/api/musixmatch` function, and that function talks to
Musixmatch. This keeps your API key on the server (never in the browser) and
avoids the CORS block that stops the browser calling Musixmatch directly.

```
App  ─►  /api/musixmatch (holds the key)  ─►  Musixmatch
```

## 1. Get a Musixmatch key

1. Sign up at **developer.musixmatch.com**.
2. Create an app to get your **API key**.

Note: the free plan returns only about the first 30% of each lyric. Full lyrics
require a paid, licensed plan — there's no self-serve price for it.

## 2. Deploy to Vercel

1. Push this repo to GitHub (already done if you're reading this there).
2. At **vercel.com**, **Add New → Project** and import the repo. Vercel detects
   Vite automatically — no build settings to change.
3. Before (or just after) the first deploy, add an environment variable:
   - **Settings → Environment Variables**
   - Name: `MUSIXMATCH_API_KEY`
   - Value: *your key from step 1*
4. **Redeploy** so the variable takes effect.

Your app is now live at `https://<project>.vercel.app`, and search works with no
further configuration — the Settings tab can stay blank.

### Test the function directly

```
https://<project>.vercel.app/api/musixmatch?path=track.search&q=hello&page_size=3
```

You should see JSON. If you see `"MUSIXMATCH_API_KEY is not set"`, add the env
var and redeploy.

## 3. Local development

```bash
npm install
npm run dev
```

The reader and sample lesson work offline. For live search locally, point dev at
your deployed functions (simplest), then restart `npm run dev`:

```bash
echo 'VITE_PROXY_TARGET=https://<project>.vercel.app' >> .env
```

(Running the functions fully locally instead needs the Vercel CLI: `npm i -g
vercel`, put `MUSIXMATCH_API_KEY` in `.env`, then `vercel dev`.)

## Troubleshooting

- **"MUSIXMATCH_API_KEY is not set on the server"** — add the env var in Vercel
  and redeploy.
- **Search fails in the Claude preview** — expected; there's no backend there.
  Use the deployed app, or the sample lesson to try the reader.
- **Lyrics look cut off** — that's the free plan's ~30% preview, not a bug.
- **A line shows "translation not available"** — Musixmatch didn't return a
  translation snippet for that line; the Polish still displays.

## Alternatives to Musixmatch

If the ~30% limit is too restrictive for personal study, a "paste your own
lyrics" mode (no key, works offline) is a small change — the reader already
takes a `{ lines: [{ pl, en }] }` shape. Open an issue or ask and it can be
added.
