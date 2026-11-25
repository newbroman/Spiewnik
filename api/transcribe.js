// ============================================================================
//  Speech transcription proxy — Vercel serverless function (/api/transcribe)
//
//  Records (client-side) are sent here and forwarded to OpenAI Whisper, so the
//  practice page can grade spoken lines accurately (far better on Polish than
//  the browser's live engine) using ONE server-side key instead of
//  each user supplying their own. Pattern mirrors the Wiersyzki app.
//
//  GET  /api/transcribe            -> { configured: true|false }
//  POST /api/transcribe  { audio(base64), mime, language } -> { text }
// ============================================================================

import { ALLOW_HEADERS } from "./_auth.js";
import { gateAI } from "./_aicap.js";

export const config = { api: { bodyParser: { sizeLimit: "8mb" } } };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
  if (req.method === "OPTIONS") return res.status(204).end();

  const KEY = process.env.OPENAI_API_KEY;

  // Lets the client pick the best engine: Whisper when a key is set, else the browser.
  if (req.method === "GET") return res.status(200).json({ configured: !!KEY });

  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const gate = await gateAI(req);
  if (gate.status === 401) return res.status(401).json({ error: "Unauthorized" });
  if (gate.status === 429) return res.status(429).json({ error: "ai_limit", message: "You've reached this month's limit for the smart features.", limit: gate.limit });
  if (!KEY) return res.status(503).json({ error: "Transcription not configured." });
  await gate.charge();

  try {
    const { audio, mime, language } = req.body || {};
    if (!audio) return res.status(400).json({ error: "No audio." });
    const buf = Buffer.from(audio, "base64");
    if (!buf.length) return res.status(400).json({ error: "Empty audio." });

    const ext = (mime || "").includes("mp4") ? "mp4" : "webm";
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: mime || "audio/webm" }), "speech." + ext);
    fd.append("model", "whisper-1");
    if (language) fd.append("language", language);

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST", headers: { Authorization: "Bearer " + KEY }, body: fd,
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(502).json({ error: "Transcription failed (" + r.status + ")", detail: detail.slice(0, 200) });
    }
    const j = await r.json();
    return res.status(200).json({ text: (j.text || "").trim() });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Transcription error" });
  }
}
