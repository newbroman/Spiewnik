// ============================================================================
//  Translation proxy — Vercel serverless function (served at /api/translate)
//
//  WHY THIS EXISTS
//  ---------------
//  The browser can't call a translation API directly (CORS), and the API key
//  must never ship in client code. This function holds the key server-side and
//  translates Polish → English. It supports two providers:
//    - DeepL     (better Polish quality; free tier 500k chars/month)
//    - Google    (Cloud Translation; also has a free tier)
//
//  It translates LINE BY LINE: the client sends an array of lines, and the
//  reply is the same-length array, so the side-by-side columns stay aligned.
//  Blank lines (verse breaks) are preserved and never sent to the API.
//
//  SETUP — set these in the Vercel project's Environment Variables:
//    TRANSLATE_PROVIDER      "deepl" (default) or "google"
//    DEEPL_API_KEY           your DeepL key        (if using DeepL)
//    GOOGLE_TRANSLATE_API_KEY your Google API key   (if using Google)
//  A request may also override the provider with {provider:"google"} in the body.
// ============================================================================

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*"); // tighten to your domain in production
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

  // Body may arrive parsed (Vercel) or as a raw string.
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const lines = Array.isArray(body?.lines) ? body.lines : null;
  const source = (body?.source || "PL").toUpperCase();
  const target = (body?.target || "EN").toUpperCase();
  const provider = (body?.provider || process.env.TRANSLATE_PROVIDER || "deepl").toLowerCase();

  if (!lines) return res.status(400).json({ error: "Send { lines: string[] }." });
  if (lines.length > 200) return res.status(400).json({ error: "Too many lines in one request (max 200)." });

  // Only translate non-empty lines; remember where the blanks were.
  const idx = [];
  const payload = [];
  lines.forEach((l, i) => { if (l && l.trim()) { idx.push(i); payload.push(l); } });

  if (payload.length === 0) return res.status(200).json({ provider, translations: lines.map(() => "") });

  try {
    const out = provider === "google"
      ? await viaGoogle(payload, source, target)
      : await viaDeepL(payload, source, target);

    // Re-expand to the original line positions, keeping blanks as "".
    const translations = lines.map(() => "");
    idx.forEach((pos, k) => { translations[pos] = out[k] ?? ""; });
    return res.status(200).json({ provider, translations });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Translation request failed.", provider });
  }
}

// ---- DeepL ----------------------------------------------------------------
async function viaDeepL(texts, source, target) {
  const key = process.env.DEEPL_API_KEY;
  if (!key) throw new Error("DEEPL_API_KEY is not set on the server.");
  // Free keys end in ":fx" and use the free host; paid keys use the pro host.
  const host = key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
  const params = new URLSearchParams();
  texts.forEach((t) => params.append("text", t));
  params.set("source_lang", source);
  params.set("target_lang", target === "EN" ? "EN-GB" : target);

  const r = await fetch(`${host}/v2/translate`, {
    method: "POST",
    headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!r.ok) throw new Error(`DeepL error ${r.status}`);
  const j = await r.json();
  return (j.translations || []).map((t) => t.text);
}

// ---- Google Cloud Translation (v2 REST) -----------------------------------
async function viaGoogle(texts, source, target) {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!key) throw new Error("GOOGLE_TRANSLATE_API_KEY is not set on the server.");
  const r = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: texts, source: source.toLowerCase(), target: target.toLowerCase(), format: "text" }),
  });
  if (!r.ok) throw new Error(`Google error ${r.status}`);
  const j = await r.json();
  return (j.data?.translations || []).map((t) => decodeEntities(t.translatedText));
}

// Google returns HTML entities even in text mode; undo the common ones.
function decodeEntities(s) {
  return (s || "")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
