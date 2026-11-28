// ---- Shareable song lists (metadata only — never lyrics) --------------------
// A list travels in the URL as /?list=<base64url JSON [{artist,title,language}]>.

export const MAX_SHARE = 50;
export const PENDING_LIST_KEY = "spiewnik.pendingList.v1";
export const PENDING_SHARE_KEY = "spiewnik.pendingShare.v1";

const clip = (s, n) => String(s || "").trim().slice(0, n);

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Keep only well-formed entries with a title, capped.
export function cleanList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => x && typeof x === "object" && clip(x.title, 200))
    .slice(0, MAX_SHARE)
    .map((x) => ({ artist: clip(x.artist, 200), title: clip(x.title, 200), language: clip(x.language, 40) || "Polish" }));
}

export function encodeList(songs) {
  const items = cleanList(songs.map((s) => ({ artist: s.artist, title: s.title, language: s.language })));
  return b64urlEncode(JSON.stringify(items));
}
export function decodeList(param) {
  try { return cleanList(JSON.parse(b64urlDecode(param || ""))); } catch { return []; }
}
export const listUrl = (songs) => `${window.location.origin}/?list=${encodeList(songs)}`;

// Share via the OS sheet where available, else copy to the clipboard.
// Resolves to "shared" | "copied" | "cancelled" | "failed".
export async function shareUrl(url, title) {
  if (navigator.share) {
    try { await navigator.share({ title, url }); return "shared"; }
    catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
  }
  try { await navigator.clipboard.writeText(url); return "copied"; } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = url; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); document.body.removeChild(ta);
    return ok ? "copied" : "failed";
  } catch { return "failed"; }
}

// A Spotify / YouTube link inside shared text (Android share often puts the URL
// in `text`, sometimes with a caption around it).
export function findMediaLink(...parts) {
  for (const p of parts) {
    const m = String(p || "").match(/https?:\/\/[^\s]+/gi) || [];
    for (const u of m) if (/(spotify\.com|youtu\.be|youtube\.com)/i.test(u)) return u.replace(/[)\].,;!?]+$/, "");
  }
  return "";
}

export function ssGet(key) { try { const v = sessionStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; } }
export function ssSet(key, val) { try { if (val == null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(val)); } catch {} }
