import { apiHeaders } from "../supabase.js";

// ---- Client side of /api/translate -----------------------------------------
// The server caps one request at 8000 chars / 400 lines (413 otherwise), so long
// songs are split into batches well under that and the results stitched back
// together in order. kind:"title" is the cheap path for titles/albums: it
// doesn't count against the free trial (server caps it at 300 chars / 4 lines).

export const MAX_CHARS = 7500;
export const MAX_LINES = 350;
// Rough size of one song, used to show the character allowance as "≈ N songs".
export const CHARS_PER_SONG = 1500;

// Split lines into batches that respect both caps, preserving order.
export function chunkLines(lines, maxChars = MAX_CHARS, maxLines = MAX_LINES) {
  const out = [];
  let cur = [], size = 0;
  for (const l of lines) {
    const len = (l || "").length + 1; // +1 for the line break it stands for
    if (cur.length && (cur.length >= maxLines || size + len > maxChars)) { out.push(cur); cur = []; size = 0; }
    cur.push(l); size += len;
  }
  if (cur.length) out.push(cur);
  return out;
}

const post = (body) => fetch("/api/translate", {
  method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
  body: JSON.stringify(body),
});

// Translate `lines` (any length). Resolves to { translations, provider, usage }.
// Rejects with an Error carrying `.status` (402 = free allowance used up).
export async function translateLines({ lines, source, target, provider, kind }) {
  const batches = kind === "title" ? [lines] : chunkLines(lines);
  const translations = [];
  let usage = null, prov = provider, legacy = {};
  for (const batch of batches) {
    // Blank-only batches (e.g. trailing verse gaps) need no round trip.
    if (!batch.some((l) => (l || "").trim())) { translations.push(...batch.map(() => "")); continue; }
    const r = await post({ lines: batch, source, target, provider, ...(kind ? { kind } : {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error((j && j.error) || "HTTP " + r.status);
      e.status = r.status; e.partial = translations; e.usage = j && j.usage;
      throw e;
    }
    const tr = Array.isArray(j.translations) ? j.translations : [];
    // Keep alignment even if the server returned a short array.
    for (let i = 0; i < batch.length; i++) translations.push(tr[i] != null ? tr[i] : "");
    if (j.usage) usage = j.usage;
    if (j.provider) prov = j.provider;
    // Older server shape (before the character-based trial).
    if ("usedOwnKey" in j || "trialRemaining" in j) legacy = { usedOwnKey: j.usedOwnKey, trialRemaining: j.trialRemaining };
  }
  return { translations, provider: prov, usage, ...legacy };
}

// Account usage: { hasKey, trial:{used,limit}, ai:{used,limit} } or null if the
// server doesn't support it yet.
export async function fetchUsage() {
  try {
    const r = await post({ op: "usage" });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || typeof j !== "object" || !("hasKey" in j || "trial" in j)) return null;
    return j;
  } catch { return null; }
}

// Save (or, with "", remove) the user's own DeepL key. The server validates it.
// Resolves to { ok:true, hasKey } or { ok:false, error }.
export async function setDeeplKey(key) {
  try {
    const r = await post({ op: "setkey", key: key || "" });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j && j.ok) return { ok: true, hasKey: !!j.hasKey };
    return { ok: false, error: (j && j.error) || "HTTP " + r.status };
  } catch (e) { return { ok: false, error: e.message || "network" }; }
}

// Characters left on the shared trial, or null when unknown.
export function trialLeft(usage) {
  const t = usage && usage.trial;
  if (!t || typeof t.limit !== "number") return null;
  return Math.max(0, t.limit - (t.used || 0));
}
