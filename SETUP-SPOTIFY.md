# Spotify player setup

Each song page can embed a Spotify player so you hear the track while reading
the lyrics. The app looks the track up automatically through `/api/spotify`,
which uses Spotify's app-only **Client Credentials** flow — no user login, and
**no card required**.

```
App  ─►  /api/spotify (holds the keys)  ─►  Spotify search  ─►  embedded player
```

## 1. Create a Spotify app (free)

1. Go to **developer.spotify.com/dashboard** and log in with any Spotify
   account (free is fine).
2. Click **Create app**. Give it any name and description (e.g. "Spiewnik").
3. For **Redirect URI**, enter anything valid — it isn't used by this flow,
   e.g. `https://spiewnik-newbroman.vercel.app`. Tick the Web API box.
4. Create it, then open the app's **Settings**. Copy the **Client ID**, and
   click **View client secret** to copy the **Client secret**.

## 2. Add the keys to Vercel

In the Vercel project → **Settings → Environment Variables**, add:

- `SPOTIFY_CLIENT_ID` = *your Client ID*
- `SPOTIFY_CLIENT_SECRET` = *your Client secret*

Then **redeploy** (Deployments → the latest → Redeploy), or just push any
commit. The player appears on each song page once this is live.

## Notes

- The app remembers each track it finds, so it only looks a song up once.
- Full playback in the embedded player needs the listener to be signed in to
  Spotify in that browser (and Premium for uninterrupted, full-length tracks);
  otherwise Spotify plays a 30-second preview. That's Spotify's rule, not the
  app's.
- If a song isn't matched, no player shows for it — the lyrics still work.
- Keys live only on the server (Vercel env vars), never in the browser bundle.
