// ---- Tiny IndexedDB key/value cache (no dependency) -------------------------
// Holds each user's song library (full rows, so opened songs read offline) and
// their profile, so the app can paint instantly and work without a network.
// Every call is best-effort: if IndexedDB is unavailable it resolves quietly.

const DB_NAME = "spiewnik";
const STORE = "kv";
let dbP = null;

function openDb() {
  if (dbP) return dbP;
  dbP = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbP;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve) => {
    if (!db) return resolve(undefined);
    try {
      const t = db.transaction(STORE, mode);
      const st = t.objectStore(STORE);
      const req = fn(st);
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => resolve(undefined);
      t.onabort = () => resolve(undefined);
    } catch { resolve(undefined); }
  }));
}

export const cacheGet = (key) => tx("readonly", (st) => st.get(key));
export const cacheSet = (key, value) => tx("readwrite", (st) => st.put(value, key));
export const cacheDel = (key) => tx("readwrite", (st) => st.delete(key));

const libKey = (uid) => "lib:" + uid;
const profKey = (uid) => "profile:" + uid;

export const getCachedLibrary = (uid) => (uid ? cacheGet(libKey(uid)) : Promise.resolve(undefined));
export const putCachedLibrary = (uid, songs) => (uid ? cacheSet(libKey(uid), songs) : Promise.resolve());
export const getCachedProfile = (uid) => (uid ? cacheGet(profKey(uid)) : Promise.resolve(undefined));
export const putCachedProfile = (uid, p) => (uid ? cacheSet(profKey(uid), p) : Promise.resolve());

// Update (or add) one song inside the cached library — used when a song is
// opened or saved so its latest text is available offline.
export async function putCachedSong(uid, song) {
  if (!uid || !song) return;
  const lib = (await getCachedLibrary(uid)) || [];
  const i = lib.findIndex((s) => s.id === song.id);
  if (i >= 0) lib[i] = song; else lib.push(song);
  await putCachedLibrary(uid, lib);
}
