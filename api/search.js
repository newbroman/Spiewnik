// ============================================================================
//  Song search proxy — Vercel serverless function (served at /api/search)
//
//  Looks up songs by artist and/or title across several catalogues and merges
//  the results, so niche repertoire (e.g. Polish artists) still shows up when
//  one source is thin. Sources, in priority order:
//    1. Spotify  — broadest catalogue, cleanest metadata (reuses the client
//                  credentials already set for playback: SPOTIFY_CLIENT_ID/SECRET)
//    2. iTunes   — free, no key, good mainstream international coverage
//    3. Deezer   — free, no key, strong European catalogue
//  Any source that is unconfigured or fails is simply skipped.
//
//  GET /api/search?q=kaśka%20sochocka
//    -> { results: [{ title, artist, album, year }] }
// ============================================================================

import { authorized, ALLOW_HEADERS } from "./_auth.js";

// Accent/case-insensitive fold, so "Życie" and "Zycie" count as the same song.
const fold = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

let spToken = { token: null, exp: 0 };
async function spotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID, secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (spToken.token && Date.now() < spToken.exp) return spToken.token;
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) return null;
  const j = await r.json();
  spToken = { token: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
  return spToken.token;
}

async function fromSpotify(q) {
  const token = await spotifyToken();
  if (!token) return [];
  const r = await fetch(
    `https://api.spotify.com/v1/search?type=track&limit=25&q=${encodeURIComponent(q)}`,
    { headers: { Authorization: "Bearer " + token } }
  );
  if (!r.ok) return [];
  const j = await r.json();
  return (j.tracks?.items || []).map((t) => ({
    title: t.name || "",
    artist: (t.artists || []).map((a) => a.name).filter(Boolean).join(", "),
    album: t.album?.name || "",
    year: (t.album?.release_date || "").slice(0, 4),
  }));
}

async function fromItunes(q) {
  const r = await fetch(
    `https://itunes.apple.com/search?media=music&entity=song&limit=25&term=${encodeURIComponent(q)}`,
    { headers: { Accept: "application/json" } }
  );
  if (!r.ok) return [];
  const j = await r.json();
  return (j.results || []).map((t) => ({
    title: t.trackName || "",
    artist: t.artistName || "",
    album: t.collectionName || "",
    year: (t.releaseDate || "").slice(0, 4),
  }));
}

async function fromDeezer(q) {
  const r = await fetch(`https://api.deezer.com/search?limit=25&q=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  const j = await r.json();
  return (j.data || []).map((t) => ({
    title: t.title || "",
    artist: t.artist?.name || "",
    album: t.album?.title || "",
    year: "",
  }));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!(await authorized(req))) return res.status(401).json({ error: "Unauthorized" });

  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(200).json({ results: [] });

  try {
    const [sp, it, dz] = await Promise.all([
      fromSpotify(q).catch(() => []),
      fromItunes(q).catch(() => []),
      fromDeezer(q).catch(() => []),
    ]);
    // Spotify first (cleanest metadata), then iTunes, then Deezer; dedup by artist|title.
    const seen = new Set();
    const results = [...sp, ...it, ...dz]
      .filter((x) => {
        if (!x.title || !x.artist) return false;
        const k = fold(x.artist) + "|" + fold(x.title);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 40);
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    return res.status(200).json({ results });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Search failed." });
  }
}
