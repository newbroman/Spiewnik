// ============================================================================
//  Shared authorization for the /api/* proxies.
//
//  A request is allowed if EITHER:
//    - it carries the app passphrase (x-spiewnik-pass) matching APP_PASSPHRASE
//      — the original single-user lock, still supported; or
//    - it carries a valid Supabase session (Authorization: Bearer <token>)
//      — the multi-user mode, where every signed-in person may use the proxies.
//
//  A request with neither a matching passphrase nor a valid token is denied,
//  so the proxies are never open to anonymous use once deployed.
//
//  TOKEN VERIFICATION
//  ------------------
//  Supabase access tokens are verified LOCALLY with `jose` against the
//  project's JWKS (${SUPABASE_URL}/auth/v1/.well-known/jwks.json, cached at
//  module scope), checking issuer `${SUPABASE_URL}/auth/v1` and audience
//  "authenticated". No network round trip per request once the keys are cached.
//
//  If local verification fails for any reason OTHER than an expired token —
//  e.g. the project still signs with a legacy HS256 secret, so the JWKS has no
//  matching key — we fall back to asking Supabase (GET /auth/v1/user).
//  An expired token is rejected outright.
//
//  getUser(req)   -> { id, email, token } | null
//  authorized(req)-> boolean
// ============================================================================

import { createRemoteJWKSet, jwtVerify } from "jose";

const SUPABASE_URL = (process.env.SUPABASE_URL || "https://dojbhuzdgzkbvvdzxmqw.supabase.co").replace(/\/+$/, "");
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || "sb_publishable_DK0ayfwXThXmJJhb6-s94Q_pvHPKGXk";

const ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`), {
  timeoutDuration: 3000,
  cooldownDuration: 30000,
  cacheMaxAge: 10 * 60 * 1000,
});

function bearer(req) {
  const header = req.headers["authorization"] || req.headers["Authorization"] || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

// Remote check, used only when local verification can't decide.
async function viaAuthServer(token) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? { id: u.id, email: u.email || null, token } : null;
  } catch {
    return null;
  }
}

// Resolve the Supabase user behind a request's Bearer token, or null.
// Returns { id, email, token } — the raw token is for per-user REST/RPC calls.
export async function getUser(req) {
  const token = bearer(req);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER, audience: "authenticated" });
    if (payload && typeof payload.sub === "string" && payload.sub) {
      return { id: payload.sub, email: payload.email || null, token };
    }
    return null;
  } catch (e) {
    if (e && e.code === "ERR_JWT_EXPIRED") return null;
    return viaAuthServer(token);
  }
}

export async function authorized(req) {
  const PASS = process.env.APP_PASSPHRASE;
  if (PASS && req.headers["x-spiewnik-pass"] === PASS) return true;
  return !!(await getUser(req));
}

// True when the request carries the legacy passphrase (single-user mode).
export function passphraseOk(req) {
  const PASS = process.env.APP_PASSPHRASE;
  return !!(PASS && req.headers["x-spiewnik-pass"] === PASS);
}

export { SUPABASE_URL, SUPABASE_ANON };

// The CORS header list every proxy should allow, now including Authorization.
export const ALLOW_HEADERS = "Content-Type, x-spiewnik-pass, Authorization";
