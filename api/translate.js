// ============================================================================
//  Translation proxy — Vercel serverless function (served at /api/translate)
//
//  WHY THIS EXISTS
//  ---------------
//  The browser can't call a translation API directly (CORS), and the API key
//  must never ship in client code. This function holds the shared key
//  server-side (and reads a user's OWN DeepL key server-side too) and
//  translates LINE BY LINE: the reply is a same-length array, so the
//  side-by-side columns stay aligned. Blank lines are preserved and never sent.
//
//  Providers: DeepL (default) and Google Cloud Translation. If the SHARED
//  DeepL key is out of quota (HTTP 456) or unset and GOOGLE_TRANSLATE_API_KEY
//  is set, the request falls back to Google automatically.
//
//  CONTRACT — all POST, JSON body, Authorization: Bearer <supabase token>
//  --------
//  1. Translate (default op)
//     { lines: string[], source?: "PL", target?: "EN", provider?: "deepl"|"google",
//       kind?: "lyrics"|"title" }
//     -> 200 { translations: string[], provider: "deepl"|"google",
//              usage: { used, limit, ownKey } }
//        usage.used / usage.limit are this month's shared-key trial CHARACTERS
//        (usage is null in legacy passphrase mode).
//     -> 413 { error: "too_large", message, limits: { maxChars, maxLines },
//              got: { chars, lines } }   — split the song and send chunks
//     -> 402 { error: "trial_exhausted", message, used, limit, needed }
//     -> 400 bad body · 401 not signed in · 502 provider error
//     -> 503 { error: "usage_unavailable" } quota store unreachable
//
//  LIMITS
//     Per request (kind "lyrics", the default): at most 8000 characters and
//     400 lines. Characters = total length of the non-blank lines sent.
//     Per request (kind "title" — song title / album name): at most 300
//     characters and 4 lines. Title requests do NOT count toward the trial.
//     Shared-key trial: TRIAL_CHARS (60000) characters per user per calendar
//     month (UTC), counted in public.usage kind "trial_chars". A request is
//     refused (402) if it would take the month's total past the limit.
//     The trial is charged only after the provider succeeds. With the user's
//     own DeepL key nothing is counted (and provider "google" is not allowed
//     to bypass that: Google always runs on the shared key and counts).
//
//  2. { op: "setkey", key: string }
//     Validates the key against DeepL /v2/usage, then saves it server-side
//     via rpc/set_deepl_key. An empty key removes it. The key is never
//     returned to the client.
//     -> 200 { ok: true, hasKey: boolean, deepl?: { used, limit } }
//     -> 400 { error: "invalid_key", message }  ·  502 DeepL unreachable
//
//  3. { op: "usage" }
//     -> 200 { hasKey, trial: { used, limit }, ai: { used, limit } }
//
//  SETUP — Vercel environment variables:
//    DEEPL_API_KEY             shared DeepL key (free keys end in ":fx")
//    GOOGLE_TRANSLATE_API_KEY  optional; Google provider + 456 fallback
//    TRANSLATE_PROVIDER        default provider, "deepl" (default) or "google"
// ============================================================================

import { getUser, passphraseOk, ALLOW_HEADERS } from "./_auth.js";
import { rpc, readUsage, consumeUsage, KIND_TRIAL } from "./_supa.js";
import { aiUsage } from "./_aicap.js";

// Free shared-key characters per user PER MONTH. One-line change.
export const TRIAL_CHARS = 60000;
export const LIMITS = {
  lyrics: { maxChars: 8000, maxLines: 400 },
  title: { maxChars: 300, maxLines: 4 },
};

const providerErr = (msg, status) => Object.assign(new Error(msg), { providerStatus: status });

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", ALLOW_HEADERS);
  if (req.method === "OPTIONS") return res.status(204).end();
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });

  // Legacy passphrase → unlimited shared key, no per-user state. Otherwise a signed-in user.
  const passOk = passphraseOk(req);
  const user = passOk ? null : await getUser(req);
  if (!passOk && !user) return res.status(401).json({ error: "Unauthorized" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body && typeof body === "object" ? body : {};

  const op = String(body.op || "translate");
  if (op === "setkey") return opSetKey(res, user, body);
  if (op === "usage") return opUsage(res, user);
  if (op !== "translate") return res.status(400).json({ error: "Unknown operation." });
  return opTranslate(res, user, body);
}

// ---- op: translate ---------------------------------------------------------
async function opTranslate(res, user, body) {
  const rawLines = Array.isArray(body.lines) ? body.lines : null;
  if (!rawLines) return res.status(400).json({ error: "Send { lines: string[] }." });
  const lines = rawLines.map((l) => (typeof l === "string" ? l : l == null ? "" : String(l)));
  const source = String(body.source || "PL").toUpperCase().slice(0, 8);
  const target = String(body.target || "EN").toUpperCase().slice(0, 8);
  const kind = body.kind === "title" ? "title" : "lyrics";
  let provider = String(body.provider || process.env.TRANSLATE_PROVIDER || "deepl").toLowerCase() === "google" ? "google" : "deepl";

  const idx = [];
  const payload = [];
  lines.forEach((l, i) => { if (l.trim()) { idx.push(i); payload.push(l); } });
  const chars = payload.reduce((n, l) => n + l.length, 0);

  const lim = LIMITS[kind];
  if (lines.length > lim.maxLines || chars > lim.maxChars) {
    return res.status(413).json({
      error: "too_large",
      message: `Too much text in one request (max ${lim.maxChars} characters and ${lim.maxLines} lines${kind === "title" ? " for a title" : ""}). Split it into smaller chunks.`,
      kind,
      limits: lim,
      got: { chars, lines: lines.length },
    });
  }

  // Which key, and how much trial is left. Key + usage are fetched together.
  let ownKey = null, used = 0;
  if (user) {
    const wantsKey = provider === "deepl";
    const [keyR, usageR] = await Promise.allSettled([
      wantsKey ? rpc(user, "get_deepl_key", {}) : Promise.resolve(null),
      readUsage(user, KIND_TRIAL),
    ]);
    if (keyR.status === "rejected") {
      // Can't tell whether they have their own key: don't guess and bill the trial.
      console.log("translate: key lookup failed", keyR.reason && keyR.reason.message);
      return res.status(503).json({ error: "usage_unavailable", message: "Usage tracking is unavailable right now. Please try again shortly." });
    }
    if (typeof keyR.value === "string" && keyR.value.trim()) ownKey = keyR.value.trim();
    const counted = !ownKey && kind !== "title";
    if (usageR.status === "fulfilled") used = usageR.value[KIND_TRIAL];
    else if (counted) {
      console.log("translate: usage read failed", usageR.reason && usageR.reason.message);
      return res.status(503).json({ error: "usage_unavailable", message: "Usage tracking is unavailable right now. Please try again shortly." });
    }
    if (counted && chars > 0 && used + chars > TRIAL_CHARS) {
      return res.status(402).json({
        error: "trial_exhausted",
        message: "You've used your free translations for this month. Add your own free DeepL key to keep translating.",
        used, limit: TRIAL_CHARS, needed: chars,
      });
    }
  }
  const usage = () => (user ? { used, limit: TRIAL_CHARS, ownKey: !!ownKey } : null);

  if (payload.length === 0) {
    return res.status(200).json({ translations: lines.map(() => ""), provider, usage: usage() });
  }

  let out;
  try {
    if (provider === "google") {
      out = await viaGoogle(payload, source, target);
    } else if (ownKey) {
      out = await viaDeepL(payload, source, target, ownKey);
    } else {
      try {
        out = await viaDeepL(payload, source, target, null);
      } catch (e) {
        const canFallback = process.env.GOOGLE_TRANSLATE_API_KEY && (e.providerStatus === 456 || e.providerStatus === "nokey");
        if (!canFallback) throw e;
        console.log("translate: shared DeepL unavailable (" + e.providerStatus + "), falling back to Google");
        provider = "google";
        out = await viaGoogle(payload, source, target);
      }
    }
  } catch (e) {
    let message = e.message || "Translation request failed.";
    if (ownKey && e.providerStatus === 403) message = "Your DeepL key was rejected. Check it in Settings.";
    if (ownKey && e.providerStatus === 456) message = "Your DeepL key's monthly quota is used up.";
    return res.status(502).json({ error: message, provider });
  }

  const translations = lines.map(() => "");
  idx.forEach((pos, k) => { translations[pos] = out[k] ?? ""; });

  // Charge the trial only for a successful shared-key lyrics translation.
  if (user && !ownKey && kind !== "title" && chars > 0) {
    try { used = await consumeUsage(user, KIND_TRIAL, chars); }
    catch (e) { console.log("translate: charge failed", e && e.message); used += chars; }
  }
  return res.status(200).json({ translations, provider, usage: usage() });
}

// ---- op: setkey ------------------------------------------------------------
async function opSetKey(res, user, body) {
  if (!user) return res.status(400).json({ error: "Sign in to save a DeepL key." });
  const key = String(body.key == null ? "" : body.key).trim();

  if (!key) {
    try { await rpc(user, "set_deepl_key", { p_key: null }); }
    catch (e) { return res.status(503).json({ error: "Couldn't remove the key right now." }); }
    return res.status(200).json({ ok: true, hasKey: false });
  }

  if (key.length > 200 || !/^[A-Za-z0-9:_-]+$/.test(key)) {
    return res.status(400).json({ error: "invalid_key", message: "That doesn't look like a DeepL key." });
  }

  // Validate with DeepL before saving.
  let deepl = null;
  try {
    const r = await fetch(`${deeplHost(key)}/v2/usage`, { headers: { Authorization: `DeepL-Auth-Key ${key}` } });
    if (r.status === 403 || r.status === 401) {
      return res.status(400).json({ error: "invalid_key", message: "DeepL rejected that key. Check you copied the whole key." });
    }
    if (!r.ok) return res.status(502).json({ error: "deepl_unavailable", message: `DeepL couldn't check the key (${r.status}). Try again.` });
    const j = await r.json().catch(() => ({}));
    deepl = { used: Number(j.character_count) || 0, limit: Number(j.character_limit) || 0 };
  } catch {
    return res.status(502).json({ error: "deepl_unavailable", message: "Couldn't reach DeepL to check the key. Try again." });
  }

  try { await rpc(user, "set_deepl_key", { p_key: key }); }
  catch (e) { return res.status(503).json({ error: "Couldn't save the key right now." }); }
  return res.status(200).json({ ok: true, hasKey: true, deepl });
}

// ---- op: usage -------------------------------------------------------------
async function opUsage(res, user) {
  if (!user) {
    // Legacy passphrase mode: no per-user state, nothing is capped.
    return res.status(200).json({ hasKey: false, trial: { used: 0, limit: null }, ai: { used: 0, limit: null } });
  }
  try {
    const [hasKey, trial, ai] = await Promise.all([
      rpc(user, "has_deepl_key", {}),
      readUsage(user, KIND_TRIAL),
      aiUsage(user),
    ]);
    return res.status(200).json({ hasKey: !!hasKey, trial: { used: trial[KIND_TRIAL], limit: TRIAL_CHARS }, ai });
  } catch (e) {
    console.log("translate: usage op failed", e && e.message);
    return res.status(503).json({ error: "usage_unavailable", message: "Usage tracking is unavailable right now." });
  }
}

// ---- DeepL ----------------------------------------------------------------
// Free keys end in ":fx" and use the free host; paid keys use the pro host.
const deeplHost = (key) => (key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com");

async function viaDeepL(texts, source, target, keyOverride) {
  const key = keyOverride || process.env.DEEPL_API_KEY;
  if (!key) throw providerErr("DEEPL_API_KEY is not set on the server.", "nokey");
  const params = new URLSearchParams();
  texts.forEach((t) => params.append("text", t));
  params.set("source_lang", source);
  params.set("target_lang", target === "EN" ? "EN-GB" : target);

  const r = await fetch(`${deeplHost(key)}/v2/translate`, {
    method: "POST",
    headers: { Authorization: `DeepL-Auth-Key ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!r.ok) throw providerErr(`DeepL error ${r.status}`, r.status);
  const j = await r.json();
  return (j.translations || []).map((t) => t.text);
}

// ---- Google Cloud Translation (v2 REST) -----------------------------------
async function viaGoogle(texts, source, target) {
  const key = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!key) throw providerErr("GOOGLE_TRANSLATE_API_KEY is not set on the server.", "nokey");
  const r = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: texts, source: source.toLowerCase(), target: target.toLowerCase(), format: "text" }),
  });
  if (!r.ok) throw providerErr(`Google error ${r.status}`, r.status);
  const j = await r.json();
  return (j.data?.translations || []).map((t) => decodeEntities(t.translatedText));
}

// Google returns HTML entities even in text mode; undo the common ones.
function decodeEntities(s) {
  return (s || "")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
