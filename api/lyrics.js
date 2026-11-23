// ============================================================================
//  Lyrics lookup proxy — Vercel serverless function (served at /api/lyrics)
//
//  Given an artist and title, tries to fetch the song's original lyric so the
//  user doesn't have to find and paste it by hand. Uses the free lyrics.ovh
//  API (no key). Coverage is good for mainstream songs and patchy for some
//  languages — when nothing is found the app falls back to manual paste.
//
//  GET /api/lyrics?artist=Zalia&title=Mój
//    -> { lyrics: "line\nline\n..." }   (lyrics null if nothing matched)
// ============================================================================

import { authorized, ALLOW_HEADERS } from "./_auth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!(await authorized(req))) return res.status(401).json({ error: "Unauthorized" });

  const artist = (req.query.artist || "").toString().trim();
  const title = (req.query.title || "").toString().trim();
  if (!title) return res.status(400).json({ error: "Missing title." });

  try {
    const r = await fetch(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
      { headers: { Accept: "application/json" } }
    );
    if (r.status === 404) return res.status(200).json({ lyrics: null });
    if (!r.ok) throw new Error(`lyrics.ovh ${r.status}`);
    const j = await r.json();
    let lyrics = (j && j.lyrics) ? j.lyrics : null;
    if (lyrics) {
      // Normalise line endings and trim a stray "Paroles de..." header if any.
      lyrics = lyrics.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
      lyrics = lyrics.replace(/^Paroles de la chanson[^\n]*\n/i, "").trim();
    }
    res.setHeader("Cache-Control", "s-maxage=604800, stale-while-revalidate");
    return res.status(200).json({ lyrics: lyrics || null });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Lyrics lookup failed." });
  }
}
