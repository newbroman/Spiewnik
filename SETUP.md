# Setup & deployment

Śpiewnik is a static Vite/React app plus serverless functions in `api/`, all on
one Vercel project, with Supabase for accounts and data. The functions hold
every secret; the browser only ever sees the Supabase publishable/anon key.

```
Browser ─► /api/* on Vercel (holds the keys) ─► OpenAI · DeepL/Google · lyrics.ovh
   │                     │                         YouTube · Spotify · iTunes · Deezer
   └────► Supabase ◄─────┘  (auth, songs, usage counters, your own DeepL key)
```

## 1. Supabase

1. Create a project at **supabase.com** (or use the existing one; its URL and
   publishable key are the defaults in `src/supabase.js` and `api/_auth.js`).
2. **Run the database migrations.** Open **SQL editor**, paste
   `supabase/migrations/001_usage_and_entitlements.sql`, and run it. Then do the
   same for each later file (`002_…`, `003_…`) in number order. They are
   idempotent, so re-running one is harmless. Other changes may add more
   numbered migrations; apply any new ones before deploying the code that needs them.
3. If you use a different project from the default, note its URL and anon /
   publishable key for step 2.

Until migration 001 is applied, translation and the AI features answer
`503 usage_unavailable`, because the server refuses to run the shared keys uncapped.

## 2. Vercel

1. At **vercel.com**, **Add New → Project** and import the repo. Vercel detects
   Vite automatically; there are no build settings to change.
2. **Settings → Environment Variables** (Production and Preview):

   | Variable | Needed for | Guide |
   | --- | --- | --- |
   | `OPENAI_API_KEY` | lyric finder, link extraction, tidy, suggestions, emoji, gloss, transcription | platform.openai.com |
   | `DEEPL_API_KEY` | translation (shared trial key) | `SETUP-TRANSLATE.md` |
   | `GOOGLE_TRANSLATE_API_KEY` | optional: Google provider + fallback when DeepL hits its quota | `SETUP-TRANSLATE.md` |
   | `TRANSLATE_PROVIDER` | optional: `deepl` (default) or `google` | |
   | `YOUTUBE_API_KEY` | YouTube player, YouTube links | `SETUP-YOUTUBE.md` |
   | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | song search, Spotify links, Spotify player | `SETUP-SPOTIFY.md` |
   | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | only if not using the default project | |
   | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | only if not using the default project (client build) | |

   No Supabase service-role key is required.
3. **Redeploy** so the variables take effect.

### Check the functions

```bash
# Should print {"configured":true} once OPENAI_API_KEY is set:
curl -s https://<project>.vercel.app/api/ai
```

Every other endpoint needs a signed-in user's token (`Authorization: Bearer …`)
and answers `401` without one.

## 3. Local development

```bash
npm install
npm run dev
```

The UI, auth and database work locally against Supabase. For `/api/*`, either
point the dev server at your deployed functions:

```bash
echo 'VITE_PROXY_TARGET=https://<project>.vercel.app' >> .env
```

or run the functions locally with the Vercel CLI (`npm i -g vercel`, put the
server variables in `.env`, then `vercel dev`).

## Troubleshooting

- **`503 usage_unavailable`**: migration 001 hasn't been applied, or Supabase is
  unreachable. Run the migration (step 1.2).
- **`402 trial_exhausted`**: the user has used this month's shared translation
  allowance. They can add their own free DeepL key in Settings.
- **`413 too_large`**: a single translate request exceeded 8,000 characters or
  400 lines. The client should split it into chunks.
- **`429 ai_limit`**: the user hit the monthly ceiling for the AI features.
- **No lyrics found**: lyrics.ovh coverage is patchy for some languages, and the
  web finder depends on search results. Paste a lyrics-page link or the text.
