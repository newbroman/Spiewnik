# Śpiewnik

A mobile-first web app for **learning a language through song**. Sign in and build
your own private library of songs in any language, reading the original and a
translation side by side, with playback, pronunciation practice, and an interface
that follows whichever language you're learning in.

Live: **https://spiewnik-seven.vercel.app**

It's a Vite/React single-page app (installable PWA) deployed to Vercel, with a
handful of serverless functions under `api/` and a Supabase backend (auth +
Postgres with Row Level Security).

## What it does

- **Accounts, private libraries.** Each person signs in (Supabase Auth) and sees
  only their own songs. Isolation is enforced in the database with Row Level
  Security, not just in the UI.
- **Find songs.** Search merges Spotify, iTunes and Deezer results; you can also
  paste a Spotify track/album/playlist link or a YouTube link, or add a song by hand.
- **Lyrics, with less typing.** A song tries, in order: an exact lookup in
  lyrics.ovh (`source: "lookup"`); a web search that reads candidate lyric pages
  and copies the lyric out of the page text (`source: "web"`, with the page URL);
  or a link the user pastes (`source: "link"`). Pasting the text by hand always
  works. Lyrics are never generated from a model's memory.
- **Auto-translate.** Line-by-line translation via DeepL (or Google). Everyone gets
  a monthly allowance of characters on the shared key, then can add **their own
  free DeepL key**, which is stored server-side and never sent back to the browser.
- **Word gloss.** Tap a word for its dictionary form, part of speech, meaning and a
  short grammar note, as used in that line.
- **Playback.** Each song resolves on YouTube (and Spotify); the player stays pinned
  while the lyrics scroll, with adjustable auto-scroll.
- **Pronunciation practice.** Hear each line (speech synthesis) and say it back for
  a per-word match score (speech recognition, with optional Whisper transcription).
- **Localised interface** in 20 languages, with English fallback.

## Stack

- **Vite + React** client in `src/`.
- **Supabase**: Auth, Postgres and Row Level Security. Tables include `songs`,
  `profiles` (target language etc.), and, from `supabase/migrations/001_*`,
  `usage` (server-owned monthly counters), `entitlements` (plan per user) and
  `user_keys` (each user's own DeepL key; write-only from the client).
- **Vercel serverless functions** in `api/` for everything that needs a secret
  or must avoid browser CORS. Files starting with `_` are shared modules, not
  endpoints (the Hobby plan allows 12 functions).

## API

| Path | Purpose |
| --- | --- |
| `api/translate.js` | Line-by-line DeepL/Google translation; trial counted in characters; ops `setkey` and `usage` |
| `api/ai.js` | OpenAI ops: `transcribe`, `suggest`, `illustrate`, `tidy`, `extract`, `findlyrics`, `gloss` |
| `api/lyrics.js` | lyrics.ovh lookup with artist/title normalisation and an in-memory cache |
| `api/search.js` | Song search (Spotify + iTunes + Deezer, merged) with an in-memory cache |
| `api/resolve.js` | Turn a pasted Spotify/YouTube link into songs |
| `api/youtube.js` / `api/spotify.js` | Resolve a song to a YouTube video / Spotify track |
| `api/_auth.js` | Auth: local JWT verification (jose + JWKS), `/auth/v1/user` fallback, legacy passphrase |
| `api/_supa.js` | Supabase REST/RPC calls made with the user's own JWT |
| `api/_aicap.js` | Per-user monthly cap for the OpenAI features |
| `api/_safefetch.js` | SSRF-safe fetch for user-supplied and scraped URLs |
| `api/_lru.js` | Small in-memory LRU cache |

Each file's header documents its request/response contract. Client-facing
changes from the server-hardening work are listed in `API_CHANGES.md`.

### Quotas (server-owned)

All counters live in `public.usage`, which users can read but not write; the
functions add to them through the `consume_usage` RPC, using the signed-in
user's own token, only **after** the provider call succeeds.

- **Translation trial:** 60,000 characters per user per month on the shared key
  (`TRIAL_CHARS` in `api/translate.js`). Your own DeepL key is not counted.
  Title/album translations (`kind: "title"`) aren't counted either.
- **Per request:** at most 8,000 characters and 400 lines (title requests: 300
  characters, 4 lines). Bigger requests get a 413 with the limits, so the
  client sends long songs in chunks.
- **OpenAI features:** 500 successful requests per user per month (`AI_LIMIT`
  in `api/_aicap.js`), an anti-abuse ceiling rather than a quota people should feel.

## Environment variables

Set these in the Vercel project (Production **and** Preview). See `.env.example`
for the full annotated list.

| Variable | Used for |
| --- | --- |
| `OPENAI_API_KEY` | All `/api/ai` features |
| `DEEPL_API_KEY` | Shared translation key (`SETUP-TRANSLATE.md`) |
| `GOOGLE_TRANSLATE_API_KEY` | Optional Google provider and automatic fallback when DeepL is out of quota |
| `TRANSLATE_PROVIDER` | Default provider, `deepl` or `google` |
| `YOUTUBE_API_KEY` | YouTube player and YouTube links (`SETUP-YOUTUBE.md`) |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Search, Spotify links, Spotify player (`SETUP-SPOTIFY.md`) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Server-side Supabase project (optional; defaults match the client) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Client build-time override of the Supabase project |
| `APP_PASSPHRASE` | Legacy single-user lock; leave unset for the multi-user app |
| `VITE_PROXY_TARGET` | Local dev only: send `/api` to a deployed instance |

No Supabase service-role key is needed by the current code.

## Database migrations

SQL migrations live in `supabase/migrations/`, numbered `001_…`, `002_…` and so
on. To apply them, open the Supabase dashboard → **SQL editor**, paste each file
**in order**, and run it. Every migration is written to be idempotent, so
re-running one is safe. Apply new migrations **before** deploying code that
depends on them. In particular the API refuses quota-checked requests
(`503 usage_unavailable`) until `001_usage_and_entitlements.sql` is in place.

More migrations (002 and later) may be added as the client and server evolve;
apply any you haven't run yet, in number order.

## Development

```bash
npm install
npm run dev      # dev server, usually http://localhost:5173
npm run build    # production build into dist/
npm run preview  # serve the production build locally
```

Auth and data work against the hosted Supabase project out of the box. For the
`/api/*` functions locally, either set `VITE_PROXY_TARGET` in `.env` to point at
a deployed instance, or run `vercel dev` with the server variables in `.env`.
Do not commit `.env`; it is git-ignored.

## Deployment (Vercel)

1. Import the repo at vercel.com; it detects Vite automatically.
2. Apply the database migrations (above).
3. Add the environment variables for Production **and** Preview.
4. Deploy. The app and `/api/*` share an origin, so nothing else needs configuring.

## Lyrics and copyright

No lyrics are bundled. Each person adds lyrics to their **own private** library for
personal study, and nothing is shared between accounts. Every fetched lyric records
where it came from (`lookup`, `web` + URL, or `link` + URL). Auto-translation is a
rough first draft to correct by hand, which is where the learning happens.
