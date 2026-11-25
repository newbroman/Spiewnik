// ============================================================================
//  Find lyrics automatically — Vercel serverless function (/api/findlyrics)
//
//  The user taps one button; if the quick lyric DB misses, this searches the
//  web for a lyrics page and has OpenAI extract ONLY the lyric — so there's no
//  "find the page, copy its URL, paste it back" dance.
//
//  Robustness: it fires SEVERAL query variants in parallel (artist+title,
//  title-only, and searches aimed at well-known lyric sites), merges and ranks
//  the result links, fetches the best candidates in parallel, then extracts
//  from each in turn until one yields a real lyric. Falls back to DuckDuckGo
//  lite if the HTML endpoint returns nothing.
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

// Pull result URLs out of a DuckDuckGo results page (html OR lite).
// Tolerant: takes uddg-wrapped links first, then any direct external https link.
function resultLinks(html, engineHost) {
  const out = [];
  const push = (href) => {
    if (!href) return;
    if (href.startsWith("//")) href = "https:" + href;
    if (!/^https?:\/\//.test(href)) return;
    try { if (new URL(href).host.includes(engineHost)) return; } catch { return; }
    out.push(href);
  };
  // 1. DDG html wraps external links as /l/?uddg=<encoded>
  let m; const uddg = /[?&]uddg=([^&"']+)/gi;
  while ((m = uddg.exec(html)) && out.length < 40) { try { push(decodeURIComponent(m[1])); } catch {} }
  // 2. Direct https hrefs (DDG lite, and any unwrapped links)
  const href = /href="(https?:\/\/[^"]+)"/gi;
  while ((m = href.exec(html)) && out.length < 60) push(m[1]);
  return out;
}

const SKIP = /(youtube\.com|youtu\.be|spotify\.com|apple\.com|deezer\.com|wikipedia\.org|facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|pinterest\.|amazon\.|discogs\.com|last\.fm|duckduckgo\.com|google\.|bing\.com|youtube-nocookie)/i;
const PREFER = /(tekst|lyric|piosenk|slowa|słowa|song|teksciory|tekstowo|groove|musixmatch|azlyrics|lyricstranslate|genius)/i;

async function fetchText(url, ms) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA, "Accept-Language": "pl,en;q=0.8" } });
    if (!r.ok) return "";
    return await r.text();
  } catch { return ""; } finally { clearTimeout(to); }
}

// One search: DDG html, falling back to DDG lite if html yields nothing.
async function search(q) {
  const html = await fetchText("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q), 7000);
  let links = resultLinks(html, "duckduckgo");
  if (!links.length) {
    const lite = await fetchText("https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(q), 7000);
    links = resultLinks(lite, "duckduckgo");
  }
  return links;
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

// Build a handful of query variants for one song.
function buildQueries(artist, title, language) {
  const pl = /polish|polski/i.test(language);
  const word = pl ? "tekst" : "lyrics";
  const qs = [];
  if (artist) qs.push(`${artist} ${title} ${word}`);
  qs.push(`${title} ${word}`);
  if (pl) {
    qs.push(`${title} tekst piosenki`);
    qs.push(`${title} site:tekstowo.pl`);
    qs.push(`${title} site:teksciory.interia.pl`);
  } else {
    if (artist) qs.push(`${artist} ${title} lyrics`);
    qs.push(`${title} site:genius.com`);
  }
  // De-dupe, cap.
  return [...new Set(qs)].slice(0, 5);
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

  const deadline = Date.now() + 26000; // stay under the 30s function cap

  try {
    // 1. Fire all query variants in parallel and merge their result links.
    const queries = buildQueries(artist, title, language);
    const linkLists = await Promise.all(queries.map((q) => search(q)));
    let links = [];
    for (const list of linkLists) links.push(...list);
    links = links.filter((u) => !SKIP.test(u));

    // De-dupe by host+path, then rank obvious lyric pages first.
    const seen = new Set();
    links = links.filter((u) => { const k = u.split(/[?#]/)[0]; if (seen.has(k)) return false; seen.add(k); return true; });
    links.sort((a, b) => (PREFER.test(b) ? 1 : 0) - (PREFER.test(a) ? 1 : 0));
    const candidates = links.slice(0, 6);
    if (!candidates.length) return res.status(200).json({ text: "" });

    // 2. Fetch the candidate pages in parallel (fast), keep ones with real text.
    const pages = await Promise.all(candidates.map(async (url) => {
      const html = await fetchText(url, 7000);
      const text = html ? htmlToText(html) : "";
      return { url, text };
    }));

    // 3. Extract from each in turn (cheap AI call) until one yields a lyric.
    for (const p of pages) {
      if (Date.now() > deadline) break;
      if (!p.text || p.text.length < 40) continue;
      const lyric = await extractLyric(KEY, p.text, language);
      if (lyric) return res.status(200).json({ text: lyric, source: p.url });
    }
    return res.status(200).json({ text: "" });
  } catch (e) {
    return res.status(502).json({ error: e.message || "Auto-find failed." });
  }
}
