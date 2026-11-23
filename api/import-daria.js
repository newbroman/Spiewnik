// ============================================================================
//  One-time import — serves at /api/import-daria
//
//  Brings the original owner's Daria ze Śląska library (lyrics + translations)
//  out of the old single-user sync store (Upstash KV) and into their Supabase
//  account. Runs server-side:
//    - reads KV with the server's KV credentials (never exposed to the client),
//    - inserts via Supabase REST using the CALLER'S session token, so Row Level
//      Security files the rows under their own user id.
//  Restricted to the original owner, and skips songs already present, so it's
//  safe to tap more than once.
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || "https://dojbhuzdgzkbvvdzxmqw.supabase.co";
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || "sb_publishable_DK0ayfwXThXmJJhb6-s94Q_pvHPKGXk";
const OWNER_ID = "4068f297-5cf7-4ab1-ba1d-93d7de2ad264";
const KV_DOC = "spiewnik:songs";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return res.status(401).json({ error: "Sign in required." });

  // Identify the caller.
  const ur = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` } });
  if (!ur.ok) return res.status(401).json({ error: "Invalid session." });
  const user = await ur.json();
  if (user.id !== OWNER_ID) return res.status(403).json({ error: "This import is only for the original library owner." });

  // Read the old store.
  const kvUrl = process.env.KV_REST_API_URL;
  const kvTok = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvTok) return res.status(500).json({ error: "Old store not configured on the server." });
  const kr = await fetch(`${kvUrl}/get/${encodeURIComponent(KV_DOC)}`, { headers: { Authorization: `Bearer ${kvTok}` } });
  if (!kr.ok) return res.status(502).json({ error: `Old store read failed (${kr.status}).` });
  const kj = await kr.json();
  let songs = [];
  try { const v = JSON.parse(kj.result || "[]"); songs = Array.isArray(v) ? v : (v.songs || []); } catch { songs = []; }
  if (!songs.length) return res.status(200).json({ inserted: 0, note: "Nothing found in the old store." });

  // Skip titles already in the account (case/accent-insensitive).
  const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const ex = await fetch(`${SUPABASE_URL}/rest/v1/songs?select=title`, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` } });
  const existing = ex.ok ? await ex.json() : [];
  const have = new Set(existing.map((r) => norm(r.title)));

  const rows = songs
    .filter((s) => s.title && s.title.trim() && !have.has(norm(s.title)))
    .map((s, i) => ({
      language: "Polish",
      artist: "Daria ze Śląska",
      title: s.title.trim(),
      pl: s.pl || "",
      en: s.en || "",
      youtube_id: s.youtubeId && s.youtubeId !== "none" ? s.youtubeId : null,
      spotify_id: s.spotifyId && s.spotifyId !== "none" ? s.spotifyId : null,
      position: i,
    }));

  if (!rows.length) return res.status(200).json({ inserted: 0, note: "Already imported." });

  const ins = await fetch(`${SUPABASE_URL}/rest/v1/songs`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!ins.ok) {
    const t = await ins.text();
    return res.status(502).json({ error: "Insert failed.", status: ins.status, detail: t.slice(0, 300) });
  }
  return res.status(200).json({ inserted: rows.length });
}
