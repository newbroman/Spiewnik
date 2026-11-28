import { norm } from "./util.js";

export const pracWords = (s) => norm(s).replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
export function grade(target, heard) {
  const t = pracWords(target); const h = new Set(pracWords(heard));
  let ok = 0; const marks = t.map((w) => { const hit = h.has(w); if (hit) ok++; return { w, ok: hit }; });
  return { pct: Math.round((100 * ok) / Math.max(1, t.length)), marks };
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => { const s = String(r.result || ""); resolve(s.slice(s.indexOf(",") + 1)); };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
