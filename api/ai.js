// ============================================================================
//  OpenAI dispatcher — ONE Vercel serverless function (served at /api/ai)
//
//  WHY THIS EXISTS
//  ---------------
//  The Vercel Hobby plan caps a deployment at 12 serverless functions. Each
//  OpenAI feature used to be its own file, which ate six of those slots. They
//  all share one key and one shape, so they're merged here and selected by an
//  `op` query param: /api/ai?op=<transcribe|suggest|illustrate|tidy|extract|
//  findlyrics>. One function, lots of headroom.
//
//  GET  /api/ai                 -> { configured }   (true when the key is set)
//  POST /api/ai?op=<name> {...} -> op-specific JSON  (see each op below)
//
//  Every POST passes the shared per-user monthly cap (gateAI) and is charged
//  once on acceptance.
// ============================================================================

import { ALLOW_HEADERS } from "./_auth.js";
import { gateAI } from "./_aicap.js";

// findlyrics does a web search + several page fetches; transcribe sends audio.
export const config = { maxDuration: 30, api: { bodyParser: { sizeLimit: "8mb" } } };

const CHAT = "https://api.openai.com/v1/chat/completions";
const UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Mobile Safari/537.36";

const mkErr = (status, payload) => Object.assign(new Error(payload.error || "error"), { status, payload });

async function chat(KEY, payload, label) {
  const r = await fetch(CHAT, {
    method: "POST",
    headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw mkErr(502, { error: (label || "AI request") + " failed (" + r.status + ")", detail: detail.slice(0, 200) });
  }
  return r.json();
}

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

function badHost(h) {
  return !h || !h.includes(".") ||
    /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "::1";
}

// ---- op: transcribe (Whisper) ----------------------------------------------
async function opTranscribe(KEY, body) {
  const { audio, mime, language } = body || {};
  if (!audio) throw mkErr(400, { error: "No audio." });
  const buf = Buffer.from(audio, "base64");
  if (!buf.length) throw mkErr(400, { error: "Empty audio." });
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
    throw mkErr(502, { error: "Transcription failed (" + r.status + ")", detail: detail.slice(0, 200) });
  }
  const j = await r.json();
  return { text: (j.text || "").trim() };
}

// ---- op: suggest (song ideas) ----------------------------------------------
async function opSuggest(KEY, body) {
  const query = ((body && body.query) || "").toString().trim();
  const language = ((body && body.language) || "").toString().trim();
  if (!query) return { results: [] };
  const prompt =
    `A language learner is looking for songs to study. Request: "${query}".` +
    (language ? ` Prefer real songs in ${language}.` : "") +
    ` List up to 10 real, existing songs that fit. Use each song's title in its original language and the performing artist's name.` +
    ` Return ONLY JSON of the form {"songs":[{"title":"...","artist":"..."}]} with no commentary.`;
  const j = await chat(KEY, { model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, temperature: 0.4 }, "AI request");
  let songs = [];
  try { songs = JSON.parse(j.choices?.[0]?.message?.content || "{}").songs || []; } catch {}
  const results = (Array.isArray(songs) ? songs : [])
    .map((s) => ({ title: (s.title || "").toString().trim(), artist: (s.artist || "").toString().trim(), album: "", year: "" }))
    .filter((s) => s.title)
    .slice(0, 10);
  return { results };
}

// ---- op: illustrate (emoji anchors) ----------------------------------------
async function opIllustrate(KEY, body) {
  const lines = Array.isArray(body && body.lines) ? body.lines.slice(0, 80) : [];
  const language = ((body && body.language) || "").toString().trim();
  if (!lines.length) return { emoji: [] };
  const prompt =
    `Below are the lines of a song${language ? ` in ${language}` : ""}, as a JSON array.` +
    ` For EACH line, give 1–2 emoji that capture its core feeling or image — a visual memory anchor for a language learner, NOT a literal word-for-word translation.` +
    ` Use conventional emoji metaphors for abstract lines (love ❤️, longing 💭, time ⏳, goodbye 👋).` +
    ` Return ONLY JSON of the form {"emoji":[ ... ]} with EXACTLY one string per input line, in the same order.` +
    ` Use an empty string "" for a blank line, a purely functional line, or one with no fitting emoji.\n\n` +
    JSON.stringify(lines);
  const j = await chat(KEY, { model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, temperature: 0.5 }, "Illustration");
  let arr = [];
  try { arr = JSON.parse(j.choices?.[0]?.message?.content || "{}").emoji || []; } catch {}
  if (!Array.isArray(arr)) arr = [];
  const emoji = lines.map((_, i) => (typeof arr[i] === "string" ? arr[i] : ""));
  return { emoji };
}

// ---- op: tidy (re-line flattened lyrics) -----------------------------------
async function opTidy(KEY, body) {
  const text = ((body && body.text) || "").toString();
  const language = ((body && body.language) || "").toString().trim();
  if (!text.trim()) return { text: "" };
  const prompt =
    `These are song lyrics${language ? ` in ${language}` : ""} that lost their line breaks when copied` +
    ` (a website flattened them into a run of text and may have appended a "read more" footer).` +
    ` Rebuild the proper lyric lines — one sung line per line.` +
    ` Keep the original words and spelling EXACTLY: do not translate, add, remove, correct or reorder any words.` +
    ` Only fix line breaks and delete any website attribution / footer / URLs. Separate verses with a single blank line.` +
    ` Reply with ONLY the cleaned lyrics as plain text, nothing else.\n\n----\n` + text;
  const j = await chat(KEY, { model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0 }, "Tidy");
  return { text: (j.choices?.[0]?.message?.content || "").trim() };
}

// ---- op: extract (lyrics from a pasted page URL) ---------------------------
async function opExtract(KEY, body) {
  const rawUrl = ((body && body.url) || "").toString().trim();
  const language = ((body && body.language) || "").toString().trim();
  let u;
  try { u = new URL(rawUrl); } catch { throw mkErr(400, { error: "That doesn't look like a link." }); }
  if (!/^https?:$/.test(u.protocol) || badHost(u.hostname)) throw mkErr(400, { error: "Unsupported link." });

  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 9000);
  let pageRes;
  try {
    pageRes = await fetch(u.toString(), {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "pl,en;q=0.8" },
    });
  } catch (e) {
    throw mkErr(502, { error: e.name === "AbortError" ? "The page took too long to load." : "Couldn't reach that page." });
  } finally { clearTimeout(to); }
  if (!pageRes.ok) throw mkErr(502, { error: "The page blocked the request (" + pageRes.status + "). Paste the text instead." });

  const text = htmlToText(await pageRes.text()).slice(0, 16000);
  if (!text) return { text: "" };
  const prompt =
    `The text below was extracted from a web page that contains a song's lyrics${language ? ` in ${language}` : ""},` +
    ` mixed in with navigation, ads, comments and other clutter.` +
    ` Return ONLY the song's lyric, as proper lines (one sung line per line), keeping the words and spelling EXACTLY —` +
    ` do not translate, add, remove, correct or reorder words. Drop everything that isn't the lyric (menus, ads, "read more", URLs, comments).` +
    ` Separate verses with a single blank line. If there is no song lyric in the text, reply with an empty line.` +
    ` Reply with ONLY the lyric as plain text.\n\n----\n` + text;
  const j = await chat(KEY, { model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0 }, "Extraction");
  return { text: (j.choices?.[0]?.message?.content || "").trim() };
}

// ---- op: findlyrics (auto web search + extract) ----------------------------
function resultLinks(html, engineHost) {
  const out = [];
  const push = (href) => {
    if (!href) return;
    if (href.startsWith("//")) href = "https:" + href;
    if (!/^https?:\/\//.test(href)) return;
    try { if (new URL(href).host.includes(engineHost)) return; } catch { return; }
    out.push(href);
  };
  let m; const uddg = /[?&]uddg=([^&"']+)/gi;
  while ((m = uddg.exec(html)) && out.length < 40) { try { push(decodeURIComponent(m[1])); } catch {} }
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

async function search(q) {
  const html = await fetchText("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q), 7000);
  let links = resultLinks(html, "duckduckgo");
  if (!links.length) {
    const lite = await fetchText("https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(q), 7000);
    links = resultLinks(lite, "duckduckgo");
  }
  return links;
}

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
  return [...new Set(qs)].slice(0, 5);
}

async function extractLyricFromText(KEY, pageText, language) {
  const prompt =
    `The text below was extracted from a web page that may contain a song's lyrics${language ? ` in ${language}` : ""},` +
    ` mixed with navigation, ads and clutter. Return ONLY the song's lyric, as proper lines (one sung line per line),` +
    ` keeping words and spelling EXACTLY — do not translate, add, remove, correct or reorder words.` +
    ` Drop everything that isn't the lyric. Separate verses with a single blank line.` +
    ` If there is NO actual song lyric in the text, reply with exactly: NONE.\n\n----\n` + pageText.slice(0, 16000);
  const r = await fetch(CHAT, {
    method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0 }),
  });
  if (!r.ok) return "";
  const j = await r.json();
  const out = (j.choices?.[0]?.message?.content || "").trim();
  return /^none\b/i.test(out) || out.length < 12 ? "" : out;
}

// Fallback when the web search finds nothing: let the model supply the lyric
// from its own knowledge. Reliable for traditional / children's / folk /
// public-domain songs — exactly the ones a datacenter-IP web search misses.
async function lyricFromKnowledge(KEY, artist, title, language) {
  const prompt =
    `You are helping a language learner add a song to their personal study library.` +
    ` Give the full, exact lyric of the song "${title}"${artist ? ` by ${artist}` : ""}${language ? `, in ${language}` : ""}` +
    ` — but ONLY if it is a traditional, folk, children's or public-domain song, or one whose words you are confident you remember verbatim.` +
    ` Output ONLY the lyric: one sung line per line, verses separated by a single blank line, words and spelling exactly as sung,` +
    ` with no title, translation, chords, notes or commentary.` +
    ` If you are not confident of the exact words, reply with exactly: NONE.`;
  const r = await fetch(CHAT, {
    method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0 }),
  });
  if (!r.ok) return "";
  const j = await r.json();
  const out = (j.choices?.[0]?.message?.content || "").trim();
  return /^none\b/i.test(out) || out.length < 12 ? "" : out;
}

async function opFindlyrics(KEY, body) {
  const artist = ((body && body.artist) || "").toString().trim();
  const title = ((body && body.title) || "").toString().trim();
  const language = ((body && body.language) || "").toString().trim();
  if (!title) return { text: "" };

  const deadline = Date.now() + 26000;
  const queries = buildQueries(artist, title, language);
  const linkLists = await Promise.all(queries.map((q) => search(q)));
  let links = [];
  for (const list of linkLists) links.push(...list);
  links = links.filter((u) => !SKIP.test(u));

  const seen = new Set();
  links = links.filter((u) => { const k = u.split(/[?#]/)[0]; if (seen.has(k)) return false; seen.add(k); return true; });
  links.sort((a, b) => (PREFER.test(b) ? 1 : 0) - (PREFER.test(a) ? 1 : 0));
  const candidates = links.slice(0, 6);

  if (candidates.length) {
    const pages = await Promise.all(candidates.map(async (url) => {
      const html = await fetchText(url, 7000);
      return { url, text: html ? htmlToText(html) : "" };
    }));
    for (const p of pages) {
      if (Date.now() > deadline) break;
      if (!p.text || p.text.length < 40) continue;
      const lyric = await extractLyricFromText(KEY, p.text, language);
      if (lyric) return { text: lyric, source: p.url };
    }
  }

  // Nothing usable from the web — ask the model directly.
  const known = await lyricFromKnowledge(KEY, artist, title, language);
  if (known) return { text: known, source: "ai" };

  return { text: "" };
}

const OPS = {
  transcribe: opTranscribe,
  suggest: opSuggest,
  illustrate: opIllustrate,
  tidy: opTidy,
  extract: opExtract,
  findlyrics: opFindlyrics,
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
  if (req.method === "OPTIONS") return res.status(204).end();

  const KEY = process.env.OPENAI_API_KEY;
  // Shared config check: all ops use the one key, so one answer serves them all.
  if (req.method === "GET") return res.status(200).json({ configured: !!KEY });
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

  let op = (req.query && req.query.op) || (body && body.op) || "";
  if (!op) { try { op = new URL(req.url, "http://x").searchParams.get("op") || ""; } catch {} }
  op = op.toString();
  const fn = OPS[op];
  if (!fn) return res.status(400).json({ error: "Unknown AI operation." });

  const gate = await gateAI(req);
  if (gate.status === 401) return res.status(401).json({ error: "Unauthorized" });
  if (gate.status === 429) return res.status(429).json({ error: "ai_limit", message: "You've reached this month's limit for the smart features.", limit: gate.limit });
  if (!KEY) return res.status(503).json({ error: "Smart features not configured." });
  await gate.charge();

  try {
    const out = await fn(KEY, body || {});
    return res.status(200).json(out);
  } catch (e) {
    return res.status(e.status || 502).json(e.payload || { error: e.message || "AI error" });
  }
}
