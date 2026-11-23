// ============================================================================
//  Sync store — Vercel serverless function (served at /api/data)
//
//  Keeps the song lyrics in a Vercel KV (Upstash Redis) store so they sync
//  across devices. One shared document holds the whole song list.
//    GET  /api/data            -> { songs: [...] | null }
//    POST /api/data {songs}    -> { ok: true, count }
//
//  Needs the KV store connected to the project, which injects:
//    KV_REST_API_URL, KV_REST_API_TOKEN
//  (Vercel project → Storage → create/connect a Redis store.)
// ============================================================================

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const DOC = "spiewnik:songs";

async function kv(command) {
  const r = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!r.ok) throw new Error(`KV ${r.status}`);
  return (await r.json()).result;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({ error: "KV store not configured on the server." });
  }

  try {
    if (req.method === "GET") {
      const v = await kv(["GET", DOC]);
      return res.status(200).json({ songs: v ? JSON.parse(v) : null });
    }
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      const songs = Array.isArray(body?.songs) ? body.songs : [];
      await kv(["SET", DOC, JSON.stringify(songs)]);
      return res.status(200).json({ ok: true, count: songs.length });
    }
    return res.status(405).json({ error: "Method not allowed." });
  } catch (e) {
    return res.status(502).json({ error: e.message || "KV request failed." });
  }
}
