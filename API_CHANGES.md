# API changes (server-hardening branch)

Client-facing contract changes in `api/`. The client must be adapted to these.
Every endpoint still needs `Authorization: Bearer <supabase access token>` (or the
legacy `x-spiewnik-pass`). **Apply `supabase/migrations/001_usage_and_entitlements.sql`
before deploying:** without it, translate and AI requests return
`503 { error: "usage_unavailable" }`.

## 1. Stop reading/writing `profiles.deepl_key` directly (required)

The client currently does
`supabase.from("profiles").select("deepl_key,trial_used,target_lang")` and
`supabase.from("profiles").upsert({ id, deepl_key })`. Both must go:

- The key now lives in `public.user_keys`, which has **no SELECT policy**, so the
  client cannot read it back. Existing keys are copied there by migration 001.
- **Save / remove the key:** `POST /api/translate { op: "setkey", key }`
  - `200 { ok: true, hasKey: true, deepl: { used, limit } }`: key validated with
    DeepL and saved. `deepl` is the key's own DeepL character usage.
  - `key: ""` (or missing) removes it: `200 { ok: true, hasKey: false }`.
  - `400 { error: "invalid_key", message }`: malformed or rejected by DeepL.
  - `502 { error: "deepl_unavailable", message }`: couldn't check it; nothing saved.
  - `503 { error }`: couldn't save.
- **Know whether a key is set:** use `hasKey` from the `usage` op (below), or call
  the RPC `supabase.rpc("has_deepl_key")` → boolean. Replace `!!profile.deepl_key`
  with this.
- `profiles.trial_used`, `trial_month`, `ai_used` and `ai_month` are **unused**
  and frozen for clients by a trigger: client writes to them are silently
  ignored. Stop selecting `trial_used` and use the `usage` op instead.
  (`profiles.target_lang` etc. are unaffected.)

## 2. `POST /api/translate`

### Request
```
{ lines: string[], source?: "PL", target?: "EN", provider?: "deepl"|"google",
  kind?: "lyrics" | "title" }          // kind defaults to "lyrics"
```
- **New `kind: "title"`** for the song title / album name. It's not counted
  toward the trial, but is capped at **300 characters and 4 lines**.
  The client currently appends title + album to the lyric lines in one call;
  send them as a separate `kind: "title"` request instead, so they don't eat
  trial characters.
- **Per-request limit (lyrics): 8,000 characters and 400 lines.** Characters =
  total length of the non-blank lines. The old limit was 200 lines (400 status);
  over the limit is now **413**:
  ```
  413 { error: "too_large", message, kind, limits: { maxChars, maxLines },
        got: { chars, lines } }
  ```
  Long songs should be split into chunks (e.g. at verse breaks) that fit both
  limits, with the results concatenated. Blank lines still come back as `""`
  in place.

### Response (changed)
```
200 { translations: string[], provider: "deepl"|"google",
      usage: { used, limit, ownKey } }     // usage is null in passphrase mode
```
- **Removed:** `trialRemaining`, `usedOwnKey`.
  Use `usage.ownKey` and `usage.limit - usage.used` (characters left this month).
- `provider` may be `"google"` even when `"deepl"` was requested: the shared
  DeepL key was out of quota (456) and the server fell back to Google.
- The trial is now counted in **characters** (60,000 per month on the shared
  key), not songs (was 30). It's charged only after a successful translation,
  and not at all when the user's own key is used.

### Errors
- `402 { error: "trial_exhausted", message, used, limit, needed }`: the request
  would take this month's total past the limit (was `{ error, message, limit }`).
  `limit - used` may still be > 0 and allow a smaller request.
- `502 { error, provider }`: provider failed. With the user's own key, `error`
  says when DeepL rejected the key (403) or the key's quota is used up (456).
- `503 { error: "usage_unavailable", message }`.

## 3. New: `POST /api/translate { op: "usage" }`
```
200 { hasKey: boolean,
      trial: { used, limit },        // shared-key characters this month
      ai:    { used, limit } }       // AI requests this month
```
In passphrase mode: `{ hasKey: false, trial: { used: 0, limit: null }, ai: { used: 0, limit: null } }`.

## 4. Lyrics provenance: `source` on every lyrics response

| Endpoint | Response with lyrics | No lyrics |
| --- | --- | --- |
| `GET /api/lyrics` | `{ lyrics, source: "lookup", query: { artist, title } }` | `{ lyrics: null, source: null }` |
| `POST /api/ai?op=findlyrics` | `{ text, source: "web", url }` | `{ text: "", source: null }` |
| `POST /api/ai?op=extract` | `{ text, source: "link", url }` | `{ text: "", source: null }` |

- **findlyrics changed:** `source` used to be the page URL (or `"ai"`); it is now
  `"web"` with the URL in `url`. **The `"ai"` value is gone**: the
  model-knowledge fallback (`lyricFromKnowledge`) has been deleted, so
  findlyrics returns nothing more often than before, and the client should
  offer paste-a-link / paste-text then.
- For `extract`, `url` is the page actually read (after redirects).
- The client should store the provenance with the song if it wants to show it.
- `/api/lyrics` now also tries a normalised pair (first artist of "A, B" /
  "A & B" / "A feat. B"; title without " - Remastered 2011", "(feat. X)",
  "[Live]", " - Radio Edit" …). `query` tells you which pair matched.
- findlyrics now has a ~15 s budget (was ~18 s + model fallback). It returns the
  first good extraction from pages fetched in parallel.

## 5. `extract` link rules (SSRF hardening)

`POST /api/ai?op=extract { url }` now refuses non-public targets and odd links:
only `http`/`https`, ports 80/443, no `user:pass@`, public IPs only (checked on
each redirect, max 3 redirects), text/HTML content only, ~2 MB cap, 9 s timeout.
Errors are `400 { error: "That doesn't look like a link." | "Unsupported link." |
"That link isn't a web page. Paste the text instead." }` or `502 { error }` for
timeouts, too many redirects and unreachable pages. The client already shows
`error` text.

## 6. New AI op: `gloss`
```
POST /api/ai?op=gloss
{ word, line?, language?, target? }     // word ≤ 40 chars, line ≤ 300 chars
-> 200 { lemma, pos, gloss, note }
```
- `lemma`: dictionary form; `pos`: one of `noun verb adjective adverb pronoun
  preposition conjunction particle numeral interjection other` (English,
  lowercase); `gloss`: short meaning in `target` (default English); `note`:
  grammar note of 15 words or fewer, in `target` (case, tense, aspect…).
- `400 { error }` for a missing or over-long word, an over-long line, or an
  over-long language name. Bad input doesn't count toward the AI cap.
- Gated and charged like the other AI ops (one unit per successful call).

## 7. AI cap behaviour
- The cap is now server-owned (`public.usage`, kind `ai`), with the same limit
  (500/month). A unit is charged **after** a successful op, and only if OpenAI
  was actually called (e.g. `suggest` with an empty query or findlyrics with no
  candidate pages costs nothing). Previously every accepted request was charged
  up front.
- New status: `503 { error: "usage_unavailable", message }`. `429 { error:
  "ai_limit", message, limit }` is unchanged.

## 8. Caching
- `Cache-Control: s-maxage=…` was removed from `/api/lyrics`, `/api/search`,
  `/api/youtube` and `/api/spotify`. Responses are now `private, no-store`.
  The server keeps a small in-memory LRU for lyrics and search instead.

## 9. Auth
- No contract change. Tokens are verified locally (JWKS) with a fallback to
  Supabase's `/auth/v1/user`. Expired tokens get `401` straight away, so the
  client should refresh the session and retry on 401 as before.
