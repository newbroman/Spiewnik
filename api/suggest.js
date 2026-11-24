// ============================================================================
//  AI song suggestions — Vercel serverless function (served at /api/suggest)
//
//  Turns a natural-language / thematic request ("Polish nursery rhymes",
//  "upbeat songs by Zalia", "sad autumn songs") into a list of real songs the
//  user can add, using OpenAI. Great for the cases a catalogue keyword search
//  handles badly. Returns the same shape as /api/search so the picker reuses it.
//
//  GET  /api/suggest                         -> { configured: true|false }
//  POST /api/suggest  { query, language }    -> { results: [{ title, artist }] }
// ============================================================================

import { authorized, ALLOW_HEADERS } from "./_auth.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
  if (req.method === "OPTIONS") return res.status(204).end();

  const KEY = process.env.OPENAI_API_KEY;
  if (req.method === "GET") return res.status(200).json({ configured: !!KEY });

  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await authorized(req))) return res.status(401).json({ error: "Unauthorized" });
  if (!KEY) return res.status(503).json({ error: "AI suggestions not configured." });

  const query = ((req.body && req.body.query) || "").toString().trim();
  const language = ((req.body && req.body.language) || "").toString().trim();
  if (!query) return res.status(200).json({ results: [] });

  const prompt =
    `A language learner is looking for songs to study. Request: "${query}".` +
    (language ? ` Prefer real songs in ${language}.` : "") +
    ` List up to 10 real, existing songs that fit. Use each song's title in its original language and the performing artist's name.` +
    ` Return ONLY JSON of the form {"songs":[{"title":"...","artist":"..."}]} with no commentary.`;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.4,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(502).json({ error: "AI request failed (" + r.status + ")", detail: detail.slice(0, 200) });
    }
    const j = await r.json();
    let songs = [];
    try { songs = JSON.parse(j.choices?.[0]?.message?.content || "{}").songs || []; } catch {}
    const results = (Array.isArray(songs) ? songs : [])
      .map((s) => ({ title: (s.title || "").toString().trim(), artist: (s.artist || "").toString().trim(), album: "", year: "" }))
      .filter((s) => s.title)
      .slice(0, 10);
    return res.status(200).json({ results });
  } catch (e) {
    return res.status(500).json({ error: e.message || "AI error" });
  }
}
