import { norm } from "./util.js";

// ---- Word folding ------------------------------------------------------------
// Letters NFD does not decompose into base + combining mark.
const FOLD = { "ł": "l", "đ": "d", "ð": "d", "ø": "o", "ß": "ss", "æ": "ae", "œ": "oe", "ı": "i", "ħ": "h", "þ": "th" };
/** Lower-case, strip diacritics (ł→l, ą→a, ż/ź→z … and NFD marks in any language). */
export const fold = (s) =>
  (s || "").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/[łđðøßæœıħþ]/g, (c) => FOLD[c]).normalize("NFC");
/** Lower-case only, keeping diacritics (NFC so composed/decomposed forms agree). */
export const lowerExact = (s) => (s || "").normalize("NFC").toLowerCase();

/** Words of a line in their written form (letters + marks; apostrophes dropped). */
export const tokens = (s) => ((s || "").normalize("NFC").replace(/['’`]/g, "").match(/[\p{L}\p{M}\p{N}]+/gu) || []);
// Kept for compatibility with older callers.
export const pracWords = (s) => norm(s).replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);

/** Compare one expected word with one given word. → "exact" | "diacritic" | "wrong" */
export function compareWord(expected, given) {
  const e = (expected || "").trim(), g = (given || "").trim();
  if (!g) return "wrong";
  if (lowerExact(e) === lowerExact(g)) return "exact";
  if (fold(e) === fold(g)) return "diacritic";
  return "wrong";
}

/**
 * Grade what was said/typed against the target line, aligned word-by-word
 * with an LCS over diacritic-folded words (order matters; not a bag of words).
 *
 * Returns { pct, exact, diacritic, missing, extra, total, marks } where marks is
 * the aligned sequence, in reading order:
 *   { w, type: "exact" | "diacritic" | "missing" | "extra", heard?, ok }
 *   w      — the correct (target) form; for "extra" the word that was added
 *   heard  — what was actually said, for "diacritic"
 *   ok     — true for exact (kept for older callers)
 * pct counts an exact word as 1 and a diacritic-only miss as ½.
 */
export function grade(target, heard) {
  const T = tokens(target), H = tokens(heard);
  const tf = T.map(fold), hf = H.map(fold);
  const n = T.length, m = H.length;
  // dp[i][j] = LCS length of T[i..] and H[j..]
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = tf[i] === hf[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const marks = [];
  let i = 0, j = 0, exact = 0, diacritic = 0, missing = 0, extra = 0;
  while (i < n || j < m) {
    if (i < n && j < m && tf[i] === hf[j]) {
      const type = lowerExact(T[i]) === lowerExact(H[j]) ? "exact" : "diacritic";
      if (type === "exact") exact++; else diacritic++;
      marks.push({ w: T[i], type, heard: H[j], ok: type === "exact" });
      i++; j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      // Prefer reporting the extra first when tied, so a substitution reads
      // "extra, then missing" consistently.
      marks.push({ w: H[j], type: "extra", ok: false }); extra++; j++;
    } else {
      marks.push({ w: T[i], type: "missing", ok: false }); missing++; i++;
    }
  }
  const pct = Math.round((100 * (exact + 0.5 * diacritic)) / Math.max(1, n));
  return { pct, exact, diacritic, missing, extra, total: n, marks };
}

// ---- Cloze (fill the gap) ----------------------------------------------------
// Very common short function words we never blank out, across a few languages.
const STOP = new Set(("i a o u w z we na do od po za ze się nie to jest jak co ten ta tak już mi mnie ci cię go jej ich mój moja " +
  "the and but for you are was this that with have not your from they them what when " +
  "el la los las que con por una uno del pero como " +
  "le les des une est pas que qui pour avec dans sur " +
  "der die das und ist nicht ein eine mit von den dem ich du").split(" "));

/** Simple seeded PRNG so a song's gaps stay stable between renders. */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/**
 * Pick one content word to hide in `line`. Returns { before, answer, after } or
 * null if the line has nothing worth hiding. Prefers words of 4+ letters that
 * are not stop-words; falls back to 3 letters.
 */
export function makeGap(line, rand = Math.random) {
  const s = (line || "").normalize("NFC");
  const re = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
  const words = [];
  let mt;
  while ((mt = re.exec(s))) words.push({ w: mt[0], at: mt.index });
  const good = (min) => words.filter((x) => [...x.w].length >= min && !STOP.has(x.w.toLowerCase()));
  let cand = good(4);
  if (!cand.length) cand = good(3);
  if (!cand.length) return null;
  const pick = cand[Math.floor(rand() * cand.length) % cand.length];
  return { before: s.slice(0, pick.at), answer: pick.w, after: s.slice(pick.at + pick.w.length) };
}

/** Build cloze items for a song: [{ idx, pl, en, before, answer, after }]. */
export function makeCloze(plLines, enLines, seed = 1) {
  const rand = rng(seed);
  const out = [];
  plLines.forEach((raw, idx) => {
    const pl = (raw || "").trim();
    if (!pl) return;
    const g = makeGap(pl, rand);
    if (g) out.push({ idx, pl, en: ((enLines && enLines[idx]) || "").trim(), ...g });
  });
  return out;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => { const s = String(r.result || ""); resolve(s.slice(s.indexOf(",") + 1)); };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
