// ============================================================================
//  YouTube lookup proxy — Vercel serverless function (served at /api/youtube)
//
//  Given a song title (and artist), finds the best-matching YouTube video and
//  returns its id, so the app can embed a player that plays the FULL track
//  inline (free). Uses the YouTube Data API v3.
//    YOUTUBE_API_KEY   (from console.cloud.google.com, no card needed)
//
//  GET /api/youtube?title=Houston&artist=Daria%20ze%20%C5%9Al%C4%85ska
//    -> { id, title, channel }   (id null if nothing matched)
// ============================================================================

import { authorized, ALLOW_HEADERS } from "./_auth.js";

const KEY = process.env.YOUTUBE_API_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
  if (req.method === "OPTIONS") return res.status(204).end();
  res.setHeader("Cache-Control", "private, no-store");

  if (!(await authorized(req))) return res.status(401).json({ error: "Unauthorized" });

  if (!KEY) return res.status(500).json({ error: "YOUTUBE_API_KEY not set on the server." });

  const title = (req.query.title || "").toString().trim();
  const artist = (req.query.artist || "").toString().trim();
  if (!title) return res.status(400).json({ error: "Missing title." });

  try {
    const q = encodeURIComponent(`${artist} ${title} official`.trim());
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true&maxResults=5&q=${q}&key=${KEY}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`YouTube ${r.status}`);
    const j = await r.json();
    const items = j.items || [];
    if (!items.length) return res.status(200).json({ id: null });

    // Prefer a result whose channel carries the artist's name, else the top hit.
    const key = (artist.split(/\s+/)[0] || "").toLowerCase();
    const pick = items.find((i) => (i.snippet?.channelTitle || "").toLowerCase().includes(key)) || items[0];

    return res.status(200).json({
      id: pick.id?.videoId || null,
      title: pick.snippet?.title,
      channel: pick.snippet?.channelTitle,
    });
  } catch (e) {
    return res.status(502).json({ error: e.message || "YouTube lookup failed." });
  }
}
