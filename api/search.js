// ============================================================================
//  Song search proxy — Vercel serverless function (served at /api/search)
//
//  Looks up songs by artist and/or title so the user can pick one instead of
//  typing the artist and title by hand. Uses the iTunes Search API (free, no
//  key, broad international coverage) and returns clean {title, artist} pairs.
//
//  GET /api/search?q=daria%20houston
//    -> { results: [{ title, artist, album, year }] }
// ============================================================================

import { authorized, ALLOW_HEADERS } from "./_auth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!(await authorized(req))) return res.status(401).json({ error: "Unauthorized" });

  const q = (req.query.q || "").toString().trim();
  if (!q) return res.status(200).json({ results: [] });

  try {
    const r = await fetch(
      `https://itunes.apple.com/search?media=music&entity=song&limit=25&term=${encodeURIComponent(q)}`,
      { headers: { Accept: "application/json" } }
    );
    if (!r.ok) throw new Error(`Search ${r.status}`);
    const j = await r.json();
    const seen = new Set();
    const results = (j.results || [])
      .map((t) => ({
        title: t.trackName || "",
        artist: t.artistName || "",
        album: t.collectionName || "",
        year: (t.releaseDate || "").slice(0, 4),
      }))
      .filter((x) => {
        if (!x.title || !x.artist) return false;
        const k = (x.artist + "|" + x.title).toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    return res.status(200).json({ results });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Search failed." });
  }
}
