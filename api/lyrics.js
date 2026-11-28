// ============================================================================
//  Lyrics lookup proxy — Vercel serverless function (served at /api/lyrics)
//
//  Given an artist and title, tries to fetch the song's original lyric so the
//  user doesn't have to find and paste it by hand. Uses the free lyrics.ovh
//  API (no key). Coverage is good for mainstream songs and patchy for some
//  languages — when nothing is found the app falls back to the web finder
//  (/api/ai op=findlyrics) or manual paste.
//
//  CONTRACT
//  --------
//  GET /api/lyrics?artist=Zalia&title=Mój
//    -> 200 { lyrics: "line\nline\n...", source: "lookup", query: { artist, title } }
//    -> 200 { lyrics: null, source: null }            nothing matched
//    -> 400 { error }  missing title     401 { error }  not signed in
//    -> 502 { error }  lyrics.ovh failed
//
//  `source` is always "lookup" when lyrics are returned (provenance: the
//  lyrics.ovh database). `query` is the artist/title pair that matched.
//
//  MATCHING
//  --------
//  The raw artist/title are tried first. If that misses, a normalised pair is
//  tried: the FIRST artist of a joined credit ("A, B", "A & B", "A feat. B",
//  "A ft. B", "A featuring B", "A; B") and the title with release-noise
//  suffixes removed (" - Remastered 2011", " - Radio Edit", " - Live",
//  "(feat. X)", "[Live]", "(Remastered)", "(Acoustic Version)", ...).
//
//  Results are kept in a small in-memory LRU (≈200 entries) keyed by the
//  normalised artist/title, so reopening a song is instant. Responses are not
//  CDN-cacheable (they're per authenticated request).
// ============================================================================

import { authorized, ALLOW_HEADERS } from "./_auth.js";
import { makeLru, fold } from "./_lru.js";

export const config = { maxDuration: 20 };

const cache = makeLru(200);
const HIT_TTL = 24 * 60 * 60 * 1000;   // a found lyric: a day
const MISS_TTL = 10 * 60 * 1000;       // a miss: ten minutes
const PER_CALL_MS = 7000;

// First artist of a joined credit.
export function firstArtist(artist) {
  const a = (artist || "").trim();
  const parts = a.split(/\s*(?:,|;|&|\s(?:feat\.?|ft\.?|featuring)\s)\s*/i);
  return (parts[0] || a).trim();
}

// Remove release-noise from a track title.
const NOISE_WORDS = "feat\\.?|ft\\.?|featuring|remaster(?:ed)?|re-?master(?:ed)?|live|radio edit|edit|single version|album version|version|mix|remix|mono|stereo|acoustic|demo|bonus track|bonus|deluxe|explicit|clean|instrumental|extended";
const BRACKET_NOISE = new RegExp(`\\s*[(\\[][^)\\]]*\\b(?:${NOISE_WORDS}|with|from)(?![a-z])[^)\\]]*[)\\]]`, "gi");
const DASH_NOISE = new RegExp(`\\s+[-–—]\\s+(?:\\d{4}\\s+)?(?:${NOISE_WORDS})(?![a-z]).*$`, "i");
export function cleanTitle(title) {
  let t = (title || "").trim();
  // Bracketed noise anywhere: "(feat. X)", "[Live]", "(2011 Remaster)".
  t = t.replace(BRACKET_NOISE, "");
  // Dash suffix: "Song - Remastered 2011", "Song - Radio Edit", "Song - Live at X", "Song - 2011 Remaster".
  t = t.replace(DASH_NOISE, "");
  // Bare trailing "feat. X".
  t = t.replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, "");
  return t.trim() || (title || "").trim();
}

async function lyricsOvh(artist, title) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), PER_CALL_MS);
  try {
    const r = await fetch(
      `https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`,
      { headers: { Accept: "application/json" }, signal: ctrl.signal }
    );
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`lyrics.ovh ${r.status}`);
    const j = await r.json();
    let lyrics = j && j.lyrics ? String(j.lyrics) : "";
    // Normalise line endings and trim a stray "Paroles de..." header if any.
    lyrics = lyrics.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
    lyrics = lyrics.replace(/^Paroles de la chanson[^\n]*\n/i, "").trim();
    return lyrics || null;
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("lyrics.ovh timed out");
    throw e;
  } finally {
    clearTimeout(to);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
  if (req.method === "OPTIONS") return res.status(204).end();
  res.setHeader("Cache-Control", "private, no-store");
  if (!(await authorized(req))) return res.status(401).json({ error: "Unauthorized" });

  const artist = (req.query.artist || "").toString().trim().slice(0, 200);
  const title = (req.query.title || "").toString().trim().slice(0, 200);
  if (!title) return res.status(400).json({ error: "Missing title." });

  const normArtist = firstArtist(artist);
  const normTitle = cleanTitle(title);
  const key = fold(normArtist) + "|" + fold(normTitle);
  const cached = cache.get(key);
  if (cached !== undefined) return res.status(200).json(cached);

  const attempts = [[artist, title]];
  if (normArtist !== artist || normTitle !== title) attempts.push([normArtist, normTitle]);

  let lastErr = null, errors = 0;
  for (const [a, t] of attempts) {
    try {
      const lyrics = await lyricsOvh(a, t);
      if (lyrics) {
        const out = { lyrics, source: "lookup", query: { artist: a, title: t } };
        cache.set(key, out, HIT_TTL);
        return res.status(200).json(out);
      }
    } catch (e) {
      lastErr = e; errors++;
    }
  }
  // Report an upstream failure only if EVERY attempt failed (vs. a clean miss).
  if (errors === attempts.length) {
    return res.status(502).json({ error: lastErr.message || "Lyrics lookup failed." });
  }
  const miss = { lyrics: null, source: null };
  if (!errors) cache.set(key, miss, MISS_TTL);
  return res.status(200).json(miss);
}
