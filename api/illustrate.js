// ============================================================================
//  Emoji illustration — Vercel serverless function (served at /api/illustrate)
//
//  For the immersive / direct method: give each lyric line 1–2 emoji that
//  capture its CONCEPT or feeling as a visual memory anchor — not a literal
//  translation. Abstract lines ("I miss you", "time passes") lean on
//  conventional emoji metaphor. Uses OpenAI (gpt-4o-mini, cheap).
//
//  GET  /api/illustrate                          -> { configured: true|false }
//  POST /api/illustrate  { lines, language }     -> { emoji: ["…", "", …] }
// ============================================================================

import { ALLOW_HEADERS } from "./_auth.js";
import { gateAI } from "./_aicap.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
  if (req.method === "OPTIONS") return res.status(204).end();

  const KEY = process.env.OPENAI_API_KEY;
  if (req.method === "GET") return res.status(200).json({ configured: !!KEY });

  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const gate = await gateAI(req);
  if (gate.status === 401) return res.status(401).json({ error: "Unauthorized" });
  if (gate.status === 429) return res.status(429).json({ error: "ai_limit", message: "You've reached this month's limit for the smart features.", limit: gate.limit });
  if (!KEY) return res.status(503).json({ error: "Illustration not configured." });
  await gate.charge();

  const lines = Array.isArray(req.body && req.body.lines) ? req.body.lines.slice(0, 80) : [];
  const language = ((req.body && req.body.language) || "").toString().trim();
  if (!lines.length) return res.status(200).json({ emoji: [] });

  const prompt =
    `Below are the lines of a song${language ? ` in ${language}` : ""}, as a JSON array.` +
    ` For EACH line, give 1–2 emoji that capture its core feeling or image — a visual memory anchor for a language learner, NOT a literal word-for-word translation.` +
    ` Use conventional emoji metaphors for abstract lines (love ❤️, longing 💭, time ⏳, goodbye 👋).` +
    ` Return ONLY JSON of the form {"emoji":[ ... ]} with EXACTLY one string per input line, in the same order.` +
    ` Use an empty string "" for a blank line, a purely functional line, or one with no fitting emoji.\n\n` +
    JSON.stringify(lines);

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.5,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(502).json({ error: "Illustration failed (" + r.status + ")", detail: detail.slice(0, 200) });
    }
    const j = await r.json();
    let arr = [];
    try { arr = JSON.parse(j.choices?.[0]?.message?.content || "{}").emoji || []; } catch {}
    if (!Array.isArray(arr)) arr = [];
    // Align length to the input (pad/truncate) so indices match the lyric lines.
    const emoji = lines.map((_, i) => (typeof arr[i] === "string" ? arr[i] : ""));
    return res.status(200).json({ emoji });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Illustration error" });
  }
}
