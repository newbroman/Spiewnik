// ============================================================================
//  Shared per-user monthly cap for the OpenAI-backed features.
//
//  WHY THIS EXISTS
//  ---------------
//  The OpenAI features (voice transcription, song suggestions, emoji
//  illustration, lyric tidy, lyric extraction, auto-find, word gloss) all run
//  on ONE shared key the operator pays for. Per-call costs are tiny, so this is
//  NOT a quota people are meant to feel — it is an anti-abuse ceiling that
//  stops a runaway loop or a malicious account from running up the bill.
//
//  HOW IT WORKS (server-owned)
//  ---------------------------
//  The counter lives in public.usage (kind = "ai", month = 'YYYY-MM' UTC),
//  which users can read but not write. Before the work we read this month's
//  total and refuse at AI_LIMIT; AFTER the OpenAI work succeeds the handler
//  calls charge(), which runs public.consume_usage('ai', 1) with the user's
//  own JWT. Failed calls never burn allowance.
//
//  Concurrent requests can each pass the check before either is charged, so a
//  user can overshoot the ceiling by a handful of calls. That's acceptable for
//  an anti-abuse cap.
//
//  If the usage table can't be read (migration not applied, Supabase down) the
//  gate fails CLOSED with 503, so the shared key is never left uncapped.
// ============================================================================

import { getUser, passphraseOk } from "./_auth.js";
import { readUsage, consumeUsage, KIND_AI } from "./_supa.js";

// Generous monthly ceiling per user. Raise/lower in one place.
export const AI_LIMIT = 500;

// Current AI usage for a signed-in user (for the usage op in translate.js).
export async function aiUsage(user) {
  const u = await readUsage(user, KIND_AI);
  return { used: u[KIND_AI], limit: AI_LIMIT };
}

// ----------------------------------------------------------------------------
//  Gate an OpenAI-backed request.
//
//  Returns one of:
//    { status: 401 }                       — not signed in (and no passphrase)
//    { status: 429, limit, used }          — monthly ceiling reached
//    { status: 503 }                       — usage store unavailable
//    { ok: true, charge, used, limit }     — allowed; call charge() on success
//
//  The legacy passphrase (single-user mode) is uncapped: charge is a no-op.
// ----------------------------------------------------------------------------
export async function gateAI(req) {
  if (passphraseOk(req)) {
    return { ok: true, charge: async () => null, used: null, limit: null };
  }

  const user = await getUser(req);
  if (!user) return { status: 401 };

  let used;
  try {
    used = (await readUsage(user, KIND_AI))[KIND_AI];
  } catch (e) {
    console.log("gateAI: usage read failed", e && e.message);
    return { status: 503 };
  }
  if (used >= AI_LIMIT) return { status: 429, limit: AI_LIMIT, used };

  // Call ONLY after the OpenAI work has succeeded. Best effort: a failed
  // charge is logged, never turned into an error for a request that worked.
  const charge = async () => {
    try {
      return await consumeUsage(user, KIND_AI, 1);
    } catch (e) {
      console.log("gateAI: charge failed", e && e.message);
      return null;
    }
  };
  return { ok: true, charge, used, limit: AI_LIMIT, user };
}
