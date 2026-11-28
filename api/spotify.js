// ============================================================================
//  Spotify lookup proxy — Vercel serverless function (served at /api/spotify)
//
//  Given a song title (and artist), finds the best-matching Spotify track and
//  returns its id, so the app can embed a player. Uses the Client Credentials
//  flow — app-only, no user login — so it needs just two server env vars:
//    SPOTIFY_CLIENT_ID
//    SPOTIFY_CLIENT_SECRET
//  Get them free (no card) at developer.spotify.com/dashboard → Create app.
//
//  GET /api/spotify?title=Houston&artist=Daria%20ze%20%C5%9Al%C4%85ska
//    -> { id, name, artist, url, embedUrl }  (id null if nothing matched)
// ============================================================================

import { authorized, ALLOW_HEADERS } from "./_auth.js";

let tokenCache = { token: null, exp: 0 };

async function getToken(id, secret) {
  if (tokenCache.token && Date.now() < tokenCache.exp) return tokenCache.token;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`Spotify token error ${r.status}`);
  const j = await r.json();
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return tokenCache.token;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
  if (req.method === "OPTIONS") return res.status(204).end();
  res.setHeader("Cache-Control", "private, no-store");

  if (!(await authorized(req))) return res.status(401).json({ error: "Unauthorized" });

  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) {
    return res.status(500).json({ error: "SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET not set on the server." });
  }

  const title = (req.query.title || "").toString().trim();
  const artist = (req.query.artist || "").toString().trim();
  if (!title) return res.status(400).json({ error: "Missing title." });

  try {
    const token = await getToken(id, secret);
    const q = encodeURIComponent(`${title} ${artist}`.trim());
    const r = await fetch(`https://api.spotify.com/v1/search?q=${q}&type=track&limit=5`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`Spotify search error ${r.status}`);
    const j = await r.json();
    const items = j.tracks?.items || [];
    if (!items.length) return res.status(200).json({ id: null });

    // Prefer a track whose artist actually matches, else take the top hit.
    const key = (artist.split(/\s+/)[0] || "").toLowerCase();
    const pick = items.find((t) => (t.artists || []).some((a) => a.name.toLowerCase().includes(key))) || items[0];

    return res.status(200).json({
      id: pick.id,
      name: pick.name,
      artist: (pick.artists || []).map((a) => a.name).join(", "),
      url: pick.external_urls?.spotify,
      embedUrl: `https://open.spotify.com/embed/track/${pick.id}`,
    });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Spotify lookup failed." });
  }
}
