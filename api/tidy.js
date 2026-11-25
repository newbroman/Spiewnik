// ============================================================================
//  Tidy / re-line lyrics — Vercel serverless function (served at /api/tidy)
//
//  Some lyric sites flatten a song into one run of text (lines separated only
//  by commas/periods) and append a "read more" footer when copied. This asks
//  OpenAI to rebuild the proper lyric lines WITHOUT changing the words — fixing
//  line breaks and removing junk only.
//
//  GET  /api/tidy                         -> { configured: true|false }
//  POST /api/tidy  { text, language }     -> { text }
// ============================================================================

import { authorized, ALLOW_HEADERS } from "./_auth.js";

export const config = { api: { bodyParser: { sizeLimit: "1mb" } } };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
  if (req.method === "OPTIONS") return res.status(204).end();

  const KEY = process.env.OPENAI_API_KEY;
  if (req.method === "GET") return res.status(200).json({ configured: !!KEY });

  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!(await authorized(req))) return res.status(401).json({ error: "Unauthorized" });
  if (!KEY) return res.status(503).json({ error: "Tidy not configured." });

  const text = ((req.body && req.body.text) || "").toString();
  const language = ((req.body && req.body.language) || "").toString().trim();
  if (!text.trim()) return res.status(200).json({ text: "" });

  const prompt =
    `These are song lyrics${language ? ` in ${language}` : ""} that lost their line breaks when copied` +
    ` (a website flattened them into a run of text and may have appended a "read more" footer).` +
    ` Rebuild the proper lyric lines — one sung line per line.` +
    ` Keep the original words and spelling EXACTLY: do not translate, add, remove, correct or reorder any words.` +
    ` Only fix line breaks and delete any website attribution / footer / URLs. Separate verses with a single blank line.` +
    ` Reply with ONLY the cleaned lyrics as plain text, nothing else.\n\n----\n` + text;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(502).json({ error: "Tidy failed (" + r.status + ")", detail: detail.slice(0, 200) });
    }
    const j = await r.json();
    const out = (j.choices?.[0]?.message?.content || "").trim();
    return res.status(200).json({ text: out });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Tidy error" });
  }
}
