// ============================================================================
//  Musixmatch proxy — Vercel serverless function (served at /api/musixmatch)
//
//  WHY THIS EXISTS
//  ---------------
//  The browser can't call Musixmatch directly (CORS), and the API key must
//  never ship in client code. This function sits between them: it adds the key
//  (from a server environment variable) and returns the response to the app.
//  Because it's deployed alongside the app on Vercel, they share an origin —
//  so the frontend just calls /api/musixmatch with no extra configuration.
//
//  SETUP
//    1. Deploy this repo to Vercel.
//    2. In the Vercel project: Settings → Environment Variables, add
//         MUSIXMATCH_API_KEY = <your key from developer.musixmatch.com>
//    3. Redeploy. Done — search works in the app.
// ============================================================================

const MX_BASE = "https://api.musixmatch.com/ws/1.1";

// Only these Musixmatch methods are allowed through the proxy.
const ALLOWED = new Set([
  "track.search",
  "track.lyrics.get",
  "track.lyrics.translation.get",
  "matcher.lyrics.get",
]);

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*"); // tighten to your domain in production
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  const key = process.env.MUSIXMATCH_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "MUSIXMATCH_API_KEY is not set on the server." });
  }

  const { path, ...params } = req.query;
  if (!path || !ALLOWED.has(path)) {
    return res.status(400).json({ error: `Unsupported or missing path: ${path}` });
  }

  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    usp.set(k, Array.isArray(v) ? v[0] : v);
  }
  usp.set("apikey", key);

  const target = `${MX_BASE}/${path}?${usp.toString()}`;

  try {
    const upstream = await fetch(target);
    const data = await upstream.json();
    res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate");
    return res.status(200).json(data);
  } catch (e) {
    return res.status(502).json({ error: "Upstream Musixmatch request failed." });
  }
}
