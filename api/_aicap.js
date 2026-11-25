// ============================================================================
//  Shared per-user monthly cap for the OpenAI-backed features.
//
//  WHY THIS EXISTS
//  ---------------
//  The OpenAI features (voice transcription, song suggestions, emoji
//  illustration, lyric tidy, lyric extraction, auto-find) all run on ONE
//  shared key the operator pays for. Per-call costs are tiny (fractions of a
//  cent), so this is NOT a quota people are meant to feel — it is an
//  anti-abuse ceiling that stops a runaway loop or a malicious account from
//  running up the bill. A normal user will never reach it.
//
//  It mirrors the DeepL trial counter in translate.js: one integer per user,
//  stamped with the calendar month, resets automatically when the month rolls
//  over. Counts every OpenAI-backed call as 1 unit.
//
//  Needs two columns on the `profiles` table:
//    ai_used   int   not null default 0
//    ai_month  text  not null default ''
// ============================================================================

import { getUser, SUPABASE_URL, SUPABASE_ANON } from "./_auth.js";

// Generous monthly ceiling per user. Raise/lower in one place.
export const AI_LIMIT = 500;

const curMonth = () => new Date().toISOString().slice(0, 7); // "2026-11"

async function getAiProfile(user) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=ai_used,ai_month`,
      { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${user.token}` } });
    if (!r.ok) return null;
    const a = await r.json();
    return a[0] || null;
  } catch { return null; }
}

// AI calls this user has made in the CURRENT month (0 after a month rolls over).
const usedThisMonth = (prof) => (prof && prof.ai_month === curMonth() ? (prof.ai_used || 0) : 0);

async function bumpAi(user, n) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${user.token}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify([{ id: user.id, ai_used: n, ai_month: curMonth(), updated_at: new Date().toISOString() }]),
    });
  } catch { /* best effort */ }
}

// ----------------------------------------------------------------------------
//  Gate an OpenAI-backed request. Call this at the top of each OpenAI proxy,
//  in place of a plain authorized(req) check.
//
//  Returns one of:
//    { status: 401 }                      — not signed in (and no passphrase)
//    { status: 429, limit }               — monthly ceiling reached
//    { ok: true, charge }                 — allowed; call charge() on success
//
//  The legacy passphrase (single-user mode) is uncapped: it returns
//  { ok: true, charge: noop }.
// ----------------------------------------------------------------------------
export async function gateAI(req) {
  const PASS = process.env.APP_PASSPHRASE;
  if (PASS && req.headers["x-spiewnik-pass"] === PASS) {
    return { ok: true, charge: async () => {} };
  }

  const user = await getUser(req);
  if (!user) return { status: 401 };

  const prof = await getAiProfile(user);
  const used = usedThisMonth(prof);
  if (used >= AI_LIMIT) return { status: 429, limit: AI_LIMIT };

  // charge() is called only after the OpenAI work succeeds, so failed calls
  // (bad page, timeout, no lyric found) don't burn the user's allowance.
  const charge = async () => { await bumpAi(user, used + 1); };
  return { ok: true, charge };
}
