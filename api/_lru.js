// ============================================================================
//  Tiny in-memory LRU cache with per-entry TTL, held at module scope.
//
//  Lives only as long as a warm serverless instance, so it's a latency/quota
//  saver for repeated lookups (the same song opened twice), not a source of
//  truth. Used by /api/lyrics and /api/search, keyed by the normalised query.
// ============================================================================

export function makeLru(max = 200) {
  const map = new Map(); // insertion order = recency order
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (hit.exp < Date.now()) { map.delete(key); return undefined; }
      map.delete(key); map.set(key, hit); // refresh recency
      return hit.value;
    },
    set(key, value, ttlMs) {
      if (map.has(key)) map.delete(key);
      map.set(key, { value, exp: Date.now() + ttlMs });
      while (map.size > max) map.delete(map.keys().next().value);
    },
    get size() { return map.size; },
  };
}

// Accent/case-insensitive fold for cache keys and de-duplication.
export const fold = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
