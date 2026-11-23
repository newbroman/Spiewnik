// ============================================================================
//  Shared authorization for the /api/* proxies.
//
//  A request is allowed if EITHER:
//    - it carries the app passphrase (x-spiewnik-pass) matching APP_PASSPHRASE
//      — the original single-user lock, still supported; or
//    - it carries a valid Supabase session (Authorization: Bearer <token>)
//      — the multi-user mode, where every signed-in person may use the proxies.
//
//  When neither a passphrase is configured on the server nor a token is sent,
//  access stays open (local/dev with nothing locked down).
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || "https://dojbhuzdgzkbvvdzxmqw.supabase.co";
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || "sb_publishable_DK0ayfwXThXmJJhb6-s94Q_pvHPKGXk";

export async function authorized(req) {
  const PASS = process.env.APP_PASSPHRASE;
  if (PASS && req.headers["x-spiewnik-pass"] === PASS) return true;

  const header = req.headers["authorization"] || req.headers["Authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
      });
      if (r.ok) return true;
    } catch { /* fall through */ }
  }

  // Nothing configured and nothing supplied → open (dev). Otherwise deny.
  if (!PASS) return true;
  return false;
}

// The CORS header list every proxy should allow, now including Authorization.
export const ALLOW_HEADERS = "Content-Type, x-spiewnik-pass, Authorization";
