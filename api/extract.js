// ============================================================================
//  Lyrics-from-a-link — Vercel serverless function (served at /api/extract)
//
//  The user pastes the URL of a lyrics page (easier than fighting a phone's
//  text selection). We fetch the page server-side, reduce the HTML to text
//  (turning <br>/block ends into real line breaks), and ask OpenAI to return
//  ONLY the song's lyric, words unchanged. Pairs with the editor's paste box.
//
//  GET  /api/extract                        -> { configured: true|false }
//  POST /api/extract  { url, language }     -> { text }
// ============================================================================

import { ALLOW_HEADERS } from "./_auth.js";
import { gateAI } from "./_aicap.js";

function htmlToText(html) {
  return (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ""; } })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function badHost(h) {
  return !h || !h.includes(".") ||
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "::1";
}

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
  if (!KEY) return res.status(503).json({ error: "Extraction not configured." });
  await gate.charge();

  const rawUrl = ((req.body && req.body.url) || "").toString().trim();
  const language = ((req.body && req.body.language) || "").toString().trim();
  let u;
  try { u = new URL(rawUrl); } catch { return res.status(400).json({ error: "That doesn't look like a link." }); }
  if (!/^https?:$/.test(u.protocol) || badHost(u.hostname)) return res.status(400).json({ error: "Unsupported link." });

  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 9000);
    const pageRes = await fetch(u.toString(), {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "pl,en;q=0.8",
      },
    }).catch((e) => { throw new Error(e.name === "AbortError" ? "The page took too long to load." : "Couldn't reach that page."); });
    clearTimeout(to);
    if (!pageRes.ok) return res.status(502).json({ error: "The page blocked the request (" + pageRes.status + "). Paste the text instead." });
    const html = await pageRes.text();
    const text = htmlToText(html).slice(0, 16000);
    if (!text) return res.status(200).json({ text: "" });

    const prompt =
      `The text below was extracted from a web page that contains a song's lyrics${language ? ` in ${language}` : ""},` +
      ` mixed in with navigation, ads, comments and other clutter.` +
      ` Return ONLY the song's lyric, as proper lines (one sung line per line), keeping the words and spelling EXACTLY —` +
      ` do not translate, add, remove, correct or reorder words. Drop everything that isn't the lyric (menus, ads, "read more", URLs, comments).` +
      ` Separate verses with a single blank line. If there is no song lyric in the text, reply with an empty line.` +
      ` Reply with ONLY the lyric as plain text.\n\n----\n` + text;

    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0 }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return res.status(502).json({ error: "Extraction failed (" + r.status + ")", detail: detail.slice(0, 200) });
    }
    const j = await r.json();
    const out = (j.choices?.[0]?.message?.content || "").trim();
    return res.status(200).json({ text: out });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Couldn't get lyrics from that link." });
  }
}
