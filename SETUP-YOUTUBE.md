# YouTube player setup

Each song page embeds a YouTube player that plays the **full track inline** so
you can hear the song while reading the lyrics. The app finds each video
automatically through `/api/youtube`, which uses the YouTube Data API v3.

```
App  ─►  /api/youtube (holds the key)  ─►  YouTube search  ─►  inline player
```

## 1. Get a YouTube Data API key (free, no card)

1. Go to **console.cloud.google.com** and select a project (you can reuse the
   one from before, or create a new one).
2. **APIs & Services → Library**, search **YouTube Data API v3**, click **Enable**.
3. **APIs & Services → Credentials → Create credentials → API key**. Copy it.
4. Click the key and under **API restrictions** choose **Restrict key → YouTube
   Data API v3**, then Save.

## 2. Add the key to Vercel

Vercel project → **Settings → Environment Variables**, add:

- `YOUTUBE_API_KEY` = *your key*

Then **redeploy** (or push any commit). The player appears on each song page.

## Notes

- Plays complete tracks for free (with the occasional ad), inline, the same on
  phone and laptop — no login, and it keeps playing while you read.
- The app remembers each video it finds, so it only looks a song up once.
- The YouTube Data API free quota (10,000 units/day; a search costs 100) is far
  more than personal study needs.
- If a song matches the wrong video, tell me the song and I'll tighten it.
- The old Spotify lookup (`api/spotify.js`) is left in the repo but unused — its
  embed only plays 30-second previews, which is why we moved to YouTube.
