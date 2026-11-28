// ---- Small localStorage helpers: recently opened songs, editor drafts -------

const RECENT_KEY = "spiewnik.recent.v1";   // { [userId]: [songId, …] } most recent first
const DRAFT_PREFIX = "spiewnik.draft.v1.";  // + songId → editor draft
const SRC_KEY = "spiewnik.lyrsrc.v1";       // { [songId]: provenance } (no DB column for it)

const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export function getRecent(uid) {
  const all = read(RECENT_KEY, {});
  return Array.isArray(all[uid]) ? all[uid] : [];
}
export function pushRecent(uid, id) {
  if (!uid || !id) return;
  const all = read(RECENT_KEY, {});
  const list = (Array.isArray(all[uid]) ? all[uid] : []).filter((x) => x !== id);
  list.unshift(id);
  all[uid] = list.slice(0, 12);
  write(RECENT_KEY, all);
}

export const getDraft = (id) => (id ? read(DRAFT_PREFIX + id, null) : null);
export const setDraft = (id, d) => { if (id) write(DRAFT_PREFIX + id, d); };
export const clearDraft = (id) => { if (id) write(DRAFT_PREFIX + id, null); };

// Where a song's lyrics came from: { kind: "lookup" | "web" | "link" | "paste", url? }
export function getLyricSource(id) { const all = read(SRC_KEY, {}); return all[id] || null; }
export function setLyricSource(id, src) {
  if (!id) return;
  const all = read(SRC_KEY, {});
  if (src) all[id] = src; else delete all[id];
  write(SRC_KEY, all);
}

// Running as the Play Store app (Trusted Web Activity)? Android passes an
// android-app:// referrer on launch only, so remember it for the session.
export function isTWA() {
  try {
    if (document.referrer.startsWith("android-app://")) { sessionStorage.setItem("spiewnik.twa", "1"); return true; }
    return sessionStorage.getItem("spiewnik.twa") === "1";
  } catch { return false; }
}
