// ============================================================================
//  Supabase REST helpers for the /api/* proxies.
//
//  Every call runs AS THE SIGNED-IN USER: apikey = anon key, Authorization =
//  the user's own JWT. No service-role key is needed — Row Level Security and
//  the SECURITY DEFINER functions in supabase/migrations/001_*.sql decide what
//  a user may do (read their own usage, add to their own counters, save /
//  read their own DeepL key).
//
//  Usage kinds (public.usage.kind):
//    "ai"           one unit per successful OpenAI-backed /api/ai request
//    "trial_chars"  characters translated on the SHARED translation key
// ============================================================================

import { SUPABASE_URL, SUPABASE_ANON } from "./_auth.js";

export const KIND_AI = "ai";
export const KIND_TRIAL = "trial_chars";

// Current month as 'YYYY-MM' in UTC — matches consume_usage() in SQL.
export const curMonth = () => new Date().toISOString().slice(0, 7);

const headers = (user, extra) => ({
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${user.token}`,
  ...extra,
});

const supaErr = (msg, status) => Object.assign(new Error(msg), { status: status || 503, supabase: true });

// POST /rest/v1/rpc/<fn>. Resolves to the function's JSON result; throws on
// any failure (callers decide whether to fail open or closed).
export async function rpc(user, fn, args) {
  let r;
  try {
    r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: headers(user, { "Content-Type": "application/json", Accept: "application/json" }),
      body: JSON.stringify(args || {}),
    });
  } catch (e) {
    throw supaErr(`Supabase rpc ${fn} unreachable`);
  }
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw Object.assign(supaErr(`Supabase rpc ${fn} failed (${r.status})`), { detail: detail.slice(0, 300), upstream: r.status });
  }
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

// Read this month's counters for the given kinds -> { [kind]: amount }.
// Missing rows count as 0. Throws if the usage table can't be read (e.g. the
// migration hasn't been applied) so quota checks fail closed.
export async function readUsage(user, kinds) {
  const list = Array.isArray(kinds) ? kinds : [kinds];
  const filter = list.length === 1 ? `kind=eq.${encodeURIComponent(list[0])}` : `kind=in.(${list.map(encodeURIComponent).join(",")})`;
  const url = `${SUPABASE_URL}/rest/v1/usage?select=kind,amount&user_id=eq.${encodeURIComponent(user.id)}&${filter}&month=eq.${curMonth()}`;
  let r;
  try {
    r = await fetch(url, { headers: headers(user, { Accept: "application/json" }) });
  } catch {
    throw supaErr("Usage store unreachable");
  }
  if (!r.ok) throw Object.assign(supaErr(`Usage read failed (${r.status})`), { upstream: r.status });
  const rows = await r.json();
  const out = {};
  for (const k of list) out[k] = 0;
  for (const row of Array.isArray(rows) ? rows : []) out[row.kind] = Number(row.amount) || 0;
  return out;
}

// Add `amount` to this month's counter for `kind`; returns the new total.
export async function consumeUsage(user, kind, amount) {
  const total = await rpc(user, "consume_usage", { p_kind: kind, p_amount: Math.ceil(amount) });
  return Number(total) || 0;
}
