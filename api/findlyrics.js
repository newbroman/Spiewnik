// ============================================================================
//  Find lyrics automatically — Vercel serverless function (/api/findlyrics)
//
//  The user taps one button; if the quick lyric DB misses, this searches the
//  web for a lyrics page (DuckDuckGo HTML, no key), fetches the best candidate
//  page, and has OpenAI extract ONLY the lyric — so there's no "find the page,
//  copy its URL, paste it back" dance. Returns the lyric and the source URL.
//
//  GET  /api/findlyrics                              -> { configured }
//  POST /api/findlyrics  { artist, title, language } -> { text, source }
// ============================================================================

import { ALLOW_HEADERS } from "./_auth.js";
import { gateAI } from "./_aicap.js";

export const config = { maxDuration: 30 };

const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36";

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
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Pull the real result URLs out of a DuckDuckGo HTML results page.
function ddgLinks(html) {
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 15) {
    let href = m[1];
    const um = href.match(/[?&]uddg=([^&]+)/);
    if (um) { try { href = decodeURIComponent(um[1]); } catch {} }
    if (href.startsWith("//")) href = "https:" + href;
    if (/^https?:\/\//.test(href)) out.push(href);
  }
  return out;
}

const SKIP = /(youtube\.com|youtu\.be|spotify\.com|apple\.com|deezer\.com|wikipedia\.org|facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|pinterest\.|amazon\.|discogs\.com|last\.fm|genius\.com\/a)/i;
const PREFER = /(tekst|lyric|piosenk|song|slowa|teksciory|tekstowo|groove|musixmatch|azlyrics|lyricstranslate)/i;

async function fetchText(url, ms) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA, "Accept-Language": "pl,en;q=0.8" } });
    if (!r.ok) return "";
    return await r.text();
  } catch { return ""; } finally { clearTimeout(to); }
}

async function extractLyric(KEY, pageText, language) {
  const prompt =
    `The text below was extracted from a web page that may contain a song's lyrics${language ? ` in ${language}` : ""},` +
    ` mixed with navigation, ads and clutter. Return ONLY the song's lyric, as proper lines (one sung line per line),` +
    ` keeping words and spelling EXACTLY — do not translate, add, remove, correct or reorder words.` +
    ` Drop everything that isn't the lyric. Separate verses with a single blank line.` +
    ` If there is NO actual song lyric in the text, reply with exactly: NONE.\n\n----\n` + pageText.slice(0, 16000);
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0 }),
  });
  if (!r.ok) return "";
  const j = await r.json();
  const out = (j.choices?.[0]?.message?.content || "").trim();
  return /^none\b/i.test(out) || out.length < 12 ? "" : out;
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
  if (!KEY) return res.status(503).json({ error: "Auto-find not configured." });
  await gate.charge();

  const artist = ((req.body && req.body.artist) || "").toString().trim();
  const title = ((req.body && req.body.title) || "").toString().trim();
  const language = ((req.body && req.body.language) || "").toString().trim();
  if (!title) return res.status(200).json({ text: "" });

  const word = /polish/i.test(language) ? "tekst" : "lyrics";
  const q = [artist, title, word].filter(Boolean).join(" ");

  try {
    const sHtml = await fetchText("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q), 8000);
    let links = ddgLinks(sHtml).filter((u) => !SKIP.test(u));
    // Prefer obvious lyric pages, keep order otherwise; de-dupe by host+path.
    const seen = new Set();
    links = links.filter((u) => { const k = u.split(/[?#]/)[0]; if (seen.has(k)) return false; seen.add(k); return true; });
    links.sort((a, b) => (PREFER.test(b) ? 1 : 0) - (PREFER.test(a) ? 1 : 0));
    const candidates = links.slice(0, 3);

    for (const url of candidates) {
      const html = await fetchText(url, 8000);
      if (!html) continue;
      const text = htmlToText(html);
      if (text.length < 40) continue;
      const lyric = await extractLyric(KEY, text, language);
      if (lyric) return res.status(200).json({ text: lyric, source: url });
    }
    return res.status(200).json({ text: "" });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Auto-find failed." });
  }
}
