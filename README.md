# Śpiewnik

A mobile-first web app for **learning a language through song**. Sign in and build
your own private library of songs in any language, reading the original and a
translation side by side, with playback, pronunciation practice, and an interface
that follows whichever language you're learning in.

Live: **https://spiewnik-seven.vercel.app**

It's a Vite/React single-page app deployed to Vercel, with a handful of serverless
functions and a Supabase backend (accounts + database), so there is no GitHub Pages
link.

## What it does

- **Accounts, private libraries.** Each person signs in (email + password via
  Supabase Auth) and sees only their own songs. Isolation is enforced in the
  database with Row Level Security, not just in the UI.
- **Any artist, any language.** The library is indexed by language and then by
  artist. Add songs by searching (iTunes Search API) or by hand.
- **Side-by-side study.** The original lyric and its translation sit in two
  aligned columns, line for line.
- **Lyrics, with less typing.** A song opens and tries to auto-fetch its lyric
  (lyrics.ovh); a prominent **Find lyrics on Google** button (tuned to the song's
  language) is the reliable fallback — copy from the results and paste.
- **Auto-translate.** Line-by-line translation via DeepL (or Google), into each
  user's chosen target language. Everyone gets a few free translations on the
  shared key, then adds **their own free DeepL key** (stored privately in their
  profile) to continue on their own quota.
- **Playback.** Each song resolves on YouTube and Spotify; the player is pinned at
  the top while the lyrics scroll underneath, with a teleprompter-style
  adjustable auto-scroll.
- **Pronunciation practice.** Hear each line (speech synthesis) and say it back for
  a per-word match score (speech recognition), in the song's language.
- **Localised interface.** The whole UI follows the user's chosen language — 20
  languages, with English fallback (see `src/i18n.js`).
- **Installable PWA.** Manifest + service worker, so it can be added to a home
  screen and run full-screen.

## Stack

- **Vite + React** single-page app (`src/App.jsx` is the whole UI; `src/i18n.js`
  the translations; `src/supabase.js` the client).
- **Supabase** — Auth, Postgres, and Row Level Security. Tables: `songs`
  (per-user songs) and `profiles` (per-user DeepL key, free-trial count, and
  target language). The publishable/anon key ships in the client; RLS is what
  protects the data.
- **Vercel serverless functions** under `api/` for everything that needs a secret
  or must avoid browser CORS.

## Project structure

| Path | Purpose |
| --- | --- |
| `src/App.jsx` | The whole app: auth, library, reader, editor, practice, players, settings |
| `src/i18n.js` | UI translations (20 languages) and the `makeT` helper |
| `src/supabase.js` | Supabase client + API auth header |
| `api/_auth.js` | Shared authorization for the proxies (Supabase session or legacy passphrase) |
| `api/translate.js` | DeepL/Google line-by-line translation; per-user key + free-trial logic |
| `api/search.js` | Song search (iTunes Search API) |
| `api/lyrics.js` | Lyric auto-fetch (lyrics.ovh) |
| `api/youtube.js` / `api/spotify.js` | Resolve a song to a YouTube video / Spotify track |
| `api/import-daria.js` | One-time owner-only import from the old single-user store |
| `api/data.js` | Legacy Upstash KV sync (single-user era; not used by the app now) |
| `vite.config.js` | Dev server + PWA (manifest, service worker) |
| `.env.example` | Template for environment variables |

## Environment variables

Set these in the Vercel project (see the `SETUP-*.md` files for each).

- `DEEPL_API_KEY`, `TRANSLATE_PROVIDER` (`deepl` or `google`), `GOOGLE_TRANSLATE_API_KEY` — translation (`SETUP-TRANSLATE.md`).
- `YOUTUBE_API_KEY` — the inline YouTube player (`SETUP-YOUTUBE.md`).
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` — the Spotify player (`SETUP-SPOTIFY.md`).
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — optional server-side overrides; defaults match the client in `src/supabase.js`. `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` override them at build time.
- `KV_REST_API_URL`, `KV_REST_API_TOKEN` — only for the legacy one-time import.
- `APP_PASSPHRASE` — legacy single-user lock; leave unset for the multi-user app.

## Development

```bash
npm install
npm run dev      # dev server, usually http://localhost:5173
npm run build    # production build into dist/
npm run preview  # serve the production build locally
```

Auth and data work against the hosted Supabase project out of the box. For the
`/api/*` functions locally, point `npm run dev` at the deployed functions by
setting `VITE_PROXY_TARGET` in `.env` (copy from `.env.example`), or run
`vercel dev`. Do not commit `.env`; it is git-ignored.

## Deployment (Vercel)

1. Import the repo at vercel.com; it detects Vite automatically.
2. Add the environment variables above (at least the Supabase, translation and
   YouTube ones) for the Production **and** Preview environments.
3. Deploy. The app and `/api/*` share an origin, so no further configuration is
   needed in the app.

## Lyrics and copyright

No lyrics are bundled. Each person adds lyrics to their **own private** library for
personal study; nothing is shared between accounts. Auto-translation is a rough
first draft to correct by hand — which is where the learning is.
