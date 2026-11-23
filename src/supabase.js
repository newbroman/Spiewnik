import { createClient } from "@supabase/supabase-js";

// The project URL and the *publishable* (anon) key are safe to ship in the
// browser: Row Level Security on the database is what actually protects each
// person's data, not the secrecy of this key. Values can be overridden at
// build time with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
const url =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://dojbhuzdgzkbvvdzxmqw.supabase.co";
const anon =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_DK0ayfwXThXmJJhb6-s94Q_pvHPKGXk";

export const supabase = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// The current access token, kept here so the /api/* proxies can be called with
// an Authorization header. Updated whenever the auth state changes.
let accessToken = "";
export const setAccessToken = (t) => { accessToken = t || ""; };
export const apiHeaders = () =>
  accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
