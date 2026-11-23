# Auto-translate setup

The **Auto-translate** button sends the Polish lyric to `/api/translate`, which
calls a translation service with a key kept on the server and returns the
English line-for-line. You pick the provider; both have a free tier.

```
App  ─►  /api/translate (holds the key)  ─►  DeepL  or  Google
```

Pick **one** provider, get its key, and set it in your Vercel project. DeepL
gives better Polish → English; Google is the alternative you asked for.

---

## Option A — DeepL (recommended for Polish)

1. Go to **deepl.com/pro-api** and create a **DeepL API Free** account. It asks
   for a card to verify you, but the free tier (500,000 characters/month) is not
   charged — a song is ~1,000–2,000 characters, so this is effectively free.
2. Open your account's **Account → API keys** page and copy the
   **Authentication Key for DeepL API**. Free keys end in `:fx`.
3. In Vercel → your project → **Settings → Environment Variables**, add:
   - `TRANSLATE_PROVIDER` = `deepl`
   - `DEEPL_API_KEY` = *your key*
4. **Redeploy**. The proxy auto-detects the free vs paid host from the key.

## Option B — Google Cloud Translation

1. Go to **console.cloud.google.com** and create a project (e.g. "spiewnik").
2. Enable billing on the project (a card is required even for the free tier).
   Cloud Translation's free allowance covers personal study comfortably.
3. **APIs & Services → Library**, search **Cloud Translation API**, click
   **Enable**.
4. **APIs & Services → Credentials → Create credentials → API key**. Copy it.
   For safety, click the key and under **API restrictions** limit it to
   **Cloud Translation API**.
5. In Vercel → **Settings → Environment Variables**, add:
   - `TRANSLATE_PROVIDER` = `google`
   - `GOOGLE_TRANSLATE_API_KEY` = *your key*
6. **Redeploy**.

> You can set both keys and switch providers from the dropdown next to the
> Auto-translate button — the request tells the server which to use.

---

## Test the function directly

After deploying, a POST to `/api/translate` should return JSON:

```bash
curl -s https://<your-project>.vercel.app/api/translate \
  -H 'Content-Type: application/json' \
  --data '{"lines":["Dzień dobry","Dziękuję"],"provider":"deepl"}'
# -> {"provider":"deepl","translations":["Good morning","Thank you"]}
```

## Notes

- The proxy translates **line by line** and preserves blank lines, so the
  side-by-side columns stay aligned.
- Machine translation of lyrics is a rough first draft — idiom and wordplay get
  flattened. Treat the English column as a starting point and correct it; that
  editing is where the language learning happens.
- Keys live only on the server (Vercel env vars), never in the browser bundle.
- Translating full copyrighted lyrics is fine for your own private study. If
  this ever becomes a public/shared app, revisit the licensing question then.
