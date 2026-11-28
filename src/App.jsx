import React, { useCallback, useEffect, useRef, useState } from "react";
import AddSong from "./views/AddSong.jsx";
import Auth, { SetNewPassword } from "./views/Auth.jsx";
import Editor from "./views/Editor.jsx";
import Help from "./views/Help.jsx";
import ImportList from "./views/ImportList.jsx";
import ListView from "./views/ListView.jsx";
import { PROVIDER_KEY, fromRow, langOf, norm } from "./lib/util.js";
import Practice from "./views/Practice.jsx";
import Reader from "./views/Reader.jsx";
import Settings from "./views/Settings.jsx";
import Shell from "./views/Shell.jsx";
import Toast from "./views/Toast.jsx";
import TourOverlay from "./views/TourOverlay.jsx";
import Welcome from "./views/Welcome.jsx";
import { apiHeaders, setAccessToken, supabase } from "./supabase.js";
import { makeT } from "./i18n.js";
import Feedback, { FeedbackChooser, openPlayFeedback } from "./views/Feedback.jsx";
import { toastBus } from "./lib/toast.js";
import { DEMO_SONG, demoSongRow } from "./lib/demoSong.js";
import { fetchUsage, setDeeplKey, translateLines } from "./lib/translate.js";
import { getCachedLibrary, getCachedProfile, putCachedLibrary, putCachedProfile, putCachedSong } from "./lib/offlineCache.js";
import { getRecent, isTWA, pushRecent } from "./lib/local.js";
import { PENDING_LIST_KEY, PENDING_SHARE_KEY, decodeList, findMediaLink, listUrl, shareUrl, ssGet, ssSet } from "./lib/shareList.js";

// Views that show one song; their URL carries ?song=<id> so a reload reopens it.
const SONG_VIEWS = ["reader", "edit", "practice"];
const urlFor = (view, id) => (SONG_VIEWS.includes(view) && id ? `/?song=${encodeURIComponent(id)}` : "/");
// Auth redirects (OAuth / magic link / password recovery) put tokens in the URL;
// leave those for supabase-js to read and clean up.
const hasAuthParams = () => /(access_token|refresh_token|error_description|[?&]code=|type=recovery)/.test(window.location.hash + window.location.search);
// ---- reader & learning ----
import Review from "./views/Review.jsx";
import Vocab from "./views/Vocab.jsx";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = checking
  const [songs, setSongs] = useState([]);
  const [profile, setProfile] = useState(null); // { target_lang } or null (no row yet)
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState(null);     // { hasKey, trial:{used,limit}, ai:{used,limit} }
  const [provider, setProvider] = useState(() => { try { return localStorage.getItem(PROVIDER_KEY) || "deepl"; } catch { return "deepl"; } });
  const [toast, setToast] = useState("");
  const [showTour, setShowTour] = useState(false);
  const [recovery, setRecovery] = useState(false);   // arrived from a password-reset link
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  const [loadFailed, setLoadFailed] = useState(false); // showing cached songs because the server didn't answer
  const [authMode, setAuthMode] = useState("signin");
  const [chooser, setChooser] = useState(false);     // feedback chooser open
  const [addPrefill, setAddPrefill] = useState("");  // shared link → AddSong
  const [pendingList, setPendingList] = useState(null); // shared song list awaiting import
  const [recentIds, setRecentIds] = useState([]);
  const freshIds = useRef(new Set());                  // songs created this session
  const deepSongRef = useRef(null);                    // ?song=<id> from the initial URL

  const flash = (m) => { setToast(m); clearTimeout(flash._t); flash._t = setTimeout(() => setToast(""), 2800); };

  // =========================================================================
  //  Router: every view change goes through go(view, params), which pushes a
  //  history entry, so Android/system Back walks back through the app. The
  //  library root is depth 0 — Back from there leaves the app as normal.
  //  setView / setCurId stay available with their old meaning.
  // =========================================================================
  const [nav, setNav] = useState({ view: "list", id: null });
  const navRef = useRef(nav);
  navRef.current = nav;
  const guardRef = useRef(null); // the open Editor's "ok to leave?" check

  const registerGuard = useCallback((fn, owner) => {
    if (fn) guardRef.current = fn;
    else if (!owner || guardRef.current === owner) guardRef.current = null;
  }, []);
  const canLeave = () => {
    const g = guardRef.current;
    if (!g) return true;
    const ok = g();
    if (ok) guardRef.current = null;
    return ok;
  };

  const go = useCallback((view, params = {}) => {
    const from = navRef.current;
    if (from.view === "edit" && view !== "edit" && !canLeave()) return;
    const id = params.id !== undefined ? params.id : view === "list" ? null : from.id;
    const depth = (window.history.state && window.history.state.depth) || 0;
    if (view === "list") {
      // Pop back to the root entry rather than stacking another library.
      if (depth > 0) { window.history.go(-depth); return; }
      window.history.replaceState({ view: "list", id: null, depth: 0 }, "", "/");
    } else if (params.replace) {
      window.history.replaceState({ view, id, depth }, "", urlFor(view, id));
    } else {
      window.history.pushState({ view, id, depth: depth + 1 }, "", urlFor(view, id));
    }
    navRef.current = { view, id };
    setNav({ view, id });
    // eslint-disable-next-line
  }, []);
  // In-app Back buttons: step back through history, or go to `fallback`.
  const back = useCallback((fallback = "list") => {
    const depth = (window.history.state && window.history.state.depth) || 0;
    if (depth > 0) window.history.back(); else go(fallback);
  }, [go]);
  // Backwards-compatible API for code that predates the router.
  const setView = useCallback((v) => go(v), [go]);
  const setCurId = useCallback((id) => { navRef.current = { ...navRef.current, id }; setNav((n) => ({ ...n, id })); }, []);
  const view = nav.view;
  const curId = nav.id;

  useEffect(() => {
    const onPop = (e) => {
      const st = e.state || { view: "list", id: null, depth: 0 };
      const from = navRef.current;
      if (from.view === "edit" && st.view !== "edit" && guardRef.current && !canLeave()) {
        // Stay: put the editor's entry back on top.
        window.history.pushState({ ...from, depth: (st.depth || 0) + 1 }, "", urlFor(from.view, from.id));
        return;
      }
      const next = { view: st.view || "list", id: st.id ?? null };
      navRef.current = next;
      setNav(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line
  }, []);

  // Initial URL: shared links (/share?…), shared lists (?list=…), deep links
  // (?song=…). Each is parked in sessionStorage until it can be handled, then
  // the address bar is reset to the library root.
  useEffect(() => {
    let u;
    try { u = new URL(window.location.href); } catch { return; }
    if (u.pathname === "/share") {
      const title = u.searchParams.get("title") || "", text = u.searchParams.get("text") || "", url = u.searchParams.get("url") || "";
      const link = findMediaLink(url, text, title);
      const q = link || [title, text].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 200);
      if (q) ssSet(PENDING_SHARE_KEY, q);
    }
    const lp = u.searchParams.get("list");
    if (lp) ssSet(PENDING_LIST_KEY, decodeList(lp));
    const sp = u.searchParams.get("song");
    if (sp) deepSongRef.current = sp;
    if (hasAuthParams()) window.history.replaceState({ view: "list", id: null, depth: 0 }, "", window.location.href);
    else window.history.replaceState({ view: "list", id: null, depth: 0 }, "", "/");
    setPendingList(ssGet(PENDING_LIST_KEY));
  }, []);

  // Relay toasts raised from any view through the module-level bus.
  useEffect(() => {
    if (!toastBus) return;
    const h = (e) => flash(e.detail);
    toastBus.addEventListener("spiewnik-toast", h);
    return () => toastBus.removeEventListener("spiewnik-toast", h);
  }, []);

  // Online / offline.
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  const offline = !online || loadFailed;

  // First-run welcome tour (once per device).
  useEffect(() => {
    if (session && profileLoaded) {
      try { if (!localStorage.getItem("spiewnik-tour-v1")) setShowTour(true); } catch {}
    }
  }, [session, profileLoaded]);
  const endTour = () => { setShowTour(false); try { localStorage.setItem("spiewnik-tour-v1", "1"); } catch {} };

  // --- Auth: track the session and keep the API token in sync ----------------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      setAccessToken(data.session?.access_token);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      setSession(s || null);
      setAccessToken(s?.access_token);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const uid = session?.user?.id || null;

  // --- Load this person's songs: cached copy first, then the server ----------
  const serverLoaded = useRef(false);
  async function loadSongs() {
    const me = uid;
    serverLoaded.current = false;
    setLoading(true);
    getCachedLibrary(me).then((cached) => {
      if (!serverLoaded.current && Array.isArray(cached) && cached.length) { setSongs(cached); setLoading(false); }
    });
    const { data, error } = await supabase
      .from("songs").select("*")
      .order("position", { ascending: true }).order("updated_at", { ascending: true });
    if (!error && data) {
      serverLoaded.current = true;
      setLoadFailed(false);
      const list = data.map(fromRow);
      setSongs(list);
      putCachedLibrary(me, list);
    } else if (error) {
      setLoadFailed(true);
    }
    setLoading(false);
  }
  async function loadProfile() {
    const me = uid;
    const cached = await getCachedProfile(me);
    if (cached) { setProfile(cached); setProfileLoaded(true); }
    const { data, error } = await supabase.from("profiles").select("target_lang").eq("id", me).maybeSingle();
    if (!error) { setProfile(data || null); if (data) putCachedProfile(me, data); }
    setProfileLoaded(true);
  }
  const refreshUsage = async () => { const u = await fetchUsage(); if (u) setUsage(u); };
  useEffect(() => {
    if (session) {
      setProfileLoaded(false); loadSongs(); loadProfile(); refreshUsage();
      setRecentIds(getRecent(session.user.id));
    } else { setSongs([]); setProfile(null); setUsage(null); setProfileLoaded(false); setLoading(false); }
    // eslint-disable-next-line
  }, [uid]);
  // Back online → refresh from the server.
  useEffect(() => { if (online && session && loadFailed) { loadSongs(); refreshUsage(); } /* eslint-disable-next-line */ }, [online]);
  // Keep the offline copy current after edits (only once the server copy is in).
  useEffect(() => { if (uid && serverLoaded.current) putCachedLibrary(uid, songs); }, [songs, uid]);

  async function saveDeeplKey(key) {
    const res = await setDeeplKey(key);
    if (!res.ok) { flash(t("tKeyErr", { msg: res.error })); return false; }
    setUsage((u) => ({ ...(u || {}), hasKey: res.hasKey }));
    refreshUsage();
    flash(key ? t("tKeySaved") : t("tKeyRemoved"));
    return true;
  }
  async function saveTargetLang(name) {
    const { error } = await supabase.from("profiles").upsert({ id: session.user.id, target_lang: name, updated_at: new Date().toISOString() });
    if (error) { flash(t("tCouldntSave", { msg: error.message })); return false; }
    await loadProfile();
    flash(makeT(name)("tTargetSet", { name })); // confirm in the newly chosen language
    return true;
  }
  // A translate response's usage ({used, limit, ownKey}) → our usage shape.
  const onUsage = (u) => {
    if (!u) return;
    setUsage((prev) => {
      const next = { ...(prev || {}) };
      if (typeof u.ownKey === "boolean") next.hasKey = u.ownKey;
      if (!u.ownKey && typeof u.limit === "number") next.trial = { used: u.used || 0, limit: u.limit };
      return next;
    });
  };
  const hasOwnKey = !!(usage && usage.hasKey);
  const targetLang = (profile && profile.target_lang) || "English";
  const t = makeT(targetLang); // for toasts fired from App

  useEffect(() => { try { localStorage.setItem(PROVIDER_KEY, provider); } catch {} }, [provider]);
  useEffect(() => { try { document.documentElement.lang = langOf(targetLang).bcp; } catch {} }, [targetLang]);

  const cur = songs.find((s) => s.id === curId);
  const recentSongs = recentIds.map((id) => songs.find((s) => s.id === id)).filter(Boolean);

  function openSong(id) {
    pushRecent(uid, id);
    setRecentIds(getRecent(uid));
    const s = songs.find((x) => x.id === id);
    if (s) putCachedSong(uid, s);
    go("reader", { id });
  }

  // Deep link (?song=<id>) once the library is in.
  useEffect(() => {
    const id = deepSongRef.current;
    if (!id || loading || !session) return;
    deepSongRef.current = null;
    if (songs.some((s) => s.id === id)) openSong(id);
    // eslint-disable-next-line
  }, [loading, session, songs]);

  // A link shared into the app (PWA share target) → Add a song, prefilled.
  useEffect(() => {
    if (!session || !profileLoaded) return;
    const q = ssGet(PENDING_SHARE_KEY);
    if (!q) return;
    ssSet(PENDING_SHARE_KEY, null);
    setAddPrefill(q);
    go("add");
    // eslint-disable-next-line
  }, [session, profileLoaded]);

  // A shared song list → the import screen once signed in.
  useEffect(() => {
    if (session && profileLoaded && pendingList && navRef.current.view !== "import") go("import");
    // eslint-disable-next-line
  }, [session, profileLoaded, pendingList]);
  const clearPendingList = () => { ssSet(PENDING_LIST_KEY, null); setPendingList(null); };

  // --- CRUD against Supabase (RLS scopes every row to this user) -------------
  const nextPosition = () => songs.reduce((m, s) => Math.max(m, s.position || 0), 0) + 1;

  async function createSong({ language, artist, title, album }) {
    const { data, error } = await supabase
      .from("songs").insert({ language, artist, title, album: album || "", pl: "", en: "", position: nextPosition() })
      .select().single();
    if (error) { flash(t("tCouldntAdd", { msg: error.message })); return; }
    const s = fromRow(data);
    freshIds.current.add(s.id);
    setSongs((p) => [...p, s]);
    pushRecent(uid, s.id); setRecentIds(getRecent(uid));
    // History becomes library → reader → editor, so Back from the editor lands on the song.
    go("reader", { id: s.id, replace: true });
    go("edit", { id: s.id });
  }

  async function addSample() {
    const { data, error } = await supabase.from("songs").insert(demoSongRow(targetLang, nextPosition())).select().single();
    if (error) { flash(t("tCouldntAdd", { msg: error.message })); return; }
    const s = fromRow(data);
    setSongs((p) => [...p, s]);
    flash(t("tSampleAdded"));
    pushRecent(uid, s.id); setRecentIds(getRecent(uid));
    go("reader", { id: s.id });
  }

  async function importList(items) {
    let pos = nextPosition();
    const rows = items.map((x) => ({ language: x.language || "Polish", artist: x.artist || "", title: x.title, album: "", pl: "", en: "", position: pos++ }));
    const { data, error } = await supabase.from("songs").insert(rows).select();
    if (error) { flash(t("tCouldntAdd", { msg: error.message })); return; }
    setSongs((p) => [...p, ...(data || []).map(fromRow)]);
    flash(t("tImported", { n: (data || []).length }));
    clearPendingList();
    go("list");
  }

  async function shareList() {
    const res = await shareUrl(listUrl(songs), t("shareListTitle"));
    if (res === "copied") flash(t("tListCopied"));
    else if (res === "shared") flash(t("tListShared"));
    else if (res === "failed") flash(t("tShareFailed"));
  }

  async function saveSong(patch) {
    if (!curId) return;
    const id = curId;
    setSongs((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s))); // optimistic
    const row = {};
    if ("title" in patch) row.title = patch.title;
    if ("artist" in patch) row.artist = patch.artist;
    if ("album" in patch) row.album = patch.album;
    if ("titleEn" in patch) row.title_en = patch.titleEn;
    if ("albumEn" in patch) row.album_en = patch.albumEn;
    if ("language" in patch) row.language = patch.language;
    if ("pl" in patch) row.pl = patch.pl;
    if ("en" in patch) row.en = patch.en;
    if ("youtubeId" in patch) row.youtube_id = patch.youtubeId;
    if ("spotifyId" in patch) row.spotify_id = patch.spotifyId;
    row.updated_at = new Date().toISOString();
    const { error } = await supabase.from("songs").update(row).eq("id", id);
    if (error) flash(t("tSaveFailed", { msg: error.message }));
  }

  // Fill in albums for songs that were added before the catalogue returned them
  // (e.g. the Daria import). Looks each up and takes a matching album.
  async function backfillAlbums() {
    const missing = songs.filter((s) => !(s.album && s.album.trim()));
    let filled = 0;
    for (const s of missing) {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(`${s.artist} ${s.title}`)}`, { headers: apiHeaders() });
        const j = await r.json();
        const results = Array.isArray(j.results) ? j.results : [];
        const nt = norm(s.title), na = norm(s.artist);
        const cand = results.filter((x) =>
          x.album && x.album.trim() && norm(x.title) === nt &&
          (na === "" || norm(x.artist).includes(na) || na.includes(norm(x.artist)))
        );
        if (!cand.length) continue;
        const best = cand.find((x) => norm(x.album) !== nt) || cand[0]; // prefer a real album over a self-titled single
        const album = best.album.trim();
        const { error } = await supabase.from("songs").update({ album, updated_at: new Date().toISOString() }).eq("id", s.id);
        if (!error) { setSongs((prev) => prev.map((x) => (x.id === s.id ? { ...x, album } : x))); filled++; }
      } catch { /* skip this one */ }
    }
    return { total: missing.length, filled };
  }

  // Translate the title + album of songs that don't have a translation yet.
  // Uses kind:"title", which doesn't draw on the free trial.
  async function backfillTitles() {
    const todo = songs.filter((s) => s.title && s.title.trim() && !(s.titleEn && s.titleEn.trim()));
    let filled = 0;
    for (const s of todo) {
      try {
        const lines = [s.title.trim(), (s.album || "").trim()];
        const { translations: tr } = await translateLines({ lines, source: langOf(s.language).code, target: langOf(targetLang).code, provider: "deepl", kind: "title" });
        const titleEn = (tr[0] || "").trim(), albumEn = (tr[1] || "").trim();
        const { error } = await supabase.from("songs")
          .update({ title_en: titleEn, album_en: albumEn, updated_at: new Date().toISOString() }).eq("id", s.id);
        if (!error) { setSongs((prev) => prev.map((x) => (x.id === s.id ? { ...x, titleEn, albumEn } : x))); filled++; }
      } catch { /* skip this one */ }
    }
    return { total: todo.length, filled };
  }

  async function removeSong(id) {
    setSongs((prev) => prev.filter((s) => s.id !== id));
    go("list");
    const { error } = await supabase.from("songs").delete().eq("id", id);
    flash(error ? t("tCouldntRemove", { msg: error.message }) : t("tSongRemoved"));
  }
  // An abandoned new song (no title, no lyrics) — drop it quietly.
  async function discardSong(id) {
    freshIds.current.delete(id);
    setSongs((prev) => prev.filter((s) => s.id !== id));
    await supabase.from("songs").delete().eq("id", id);
  }

  const signOut = async () => { await supabase.auth.signOut(); go("list"); };

  // =========================================================================
  if (recovery) {
    return <Shell lang={targetLang}><SetNewPassword onDone={() => { setRecovery(false); flash(t("tPwUpdated")); }} /><Toast toast={toast} /></Shell>;
  }
  if (session === undefined) {
    return <Shell lang={targetLang}><div className="splash">Śpiewnik…</div></Shell>;
  }
  if (session === null) {
    // Signed out: the sign-in screen, or the read-only sample song.
    const askSignUp = () => { flash(t("demoSignUp")); setAuthMode("signup"); go("list"); };
    return (
      <Shell lang={targetLang}>
        {view === "demo" ? (
          <>
            <div className="demobar">
              <span>{t("demoBanner")}</span>
              <button onClick={() => { setAuthMode("signup"); go("list"); }}>{t("demoCta")}</button>
            </div>
            <Reader song={DEMO_SONG} targetLang="English" onBack={() => back("list")}
              onEdit={askSignUp} onPractice={askSignUp} onFoundMedia={() => {}} />
          </>
        ) : (
          <Auth key={authMode} initialMode={authMode} onDemo={() => go("demo")}
            notice={pendingList && pendingList.length ? t("importSignIn", { n: pendingList.length }) : ""} />
        )}
        <Toast toast={toast} />
      </Shell>
    );
  }
  // Brand-new account: ask once which language to translate into.
  if (profileLoaded && !loading && profile === null && songs.length === 0) {
    return <Shell lang={targetLang}><Welcome onPick={saveTargetLang} /><Toast toast={toast} /></Shell>;
  }

  return (
    <Shell lang={targetLang}>
      {(view === "list" || (SONG_VIEWS.includes(view) && !cur && !loading)) && (
        <ListView
          songs={songs} loading={loading} email={session.user.email}
          recent={recentSongs} offline={offline}
          onOpen={openSong}
          onReview={() => go("review")} onVocab={() => go("vocab")}
          onDelete={(id) => removeSong(id)}
          onAdd={() => { setAddPrefill(""); go("add"); }}
          onSettings={() => go("settings")}
          onSignOut={signOut}
          onHelp={() => go("help")}
          onFeedback={() => setChooser(true)}
          onShareList={songs.length ? shareList : null}
          onAddSample={addSample}
        />
      )}
      {view === "help" && <Help onBack={() => back()} onReplayTour={() => { go("list"); setShowTour(true); }} />}
      {showTour && <TourOverlay onClose={endTour} onAdd={() => { endTour(); setAddPrefill(""); go("add"); }} />}
      {chooser && (
        <FeedbackChooser preferPlay={isTWA()} onClose={() => setChooser(false)}
          onInApp={() => { setChooser(false); go("feedback"); }}
          onPlay={() => { setChooser(false); openPlayFeedback(); }} />
      )}
      {view === "feedback" && (
        <Feedback email={session.user.email} onBack={() => back()}
          onSent={() => { go("list"); flash(t("feedbackThanks")); }} />
      )}
      {view === "import" && (
        <ImportList list={pendingList || []} songs={songs} offline={offline}
          onAdd={importList} onSkip={() => { clearPendingList(); go("list"); }} />
      )}
      {view === "settings" && (
        <Settings usage={usage} hasOwnKey={hasOwnKey} targetLang={targetLang}
          onSave={saveDeeplKey} onSaveTarget={saveTargetLang} onBack={() => back()}
          missingAlbums={songs.filter((s) => !(s.album && s.album.trim())).length} onBackfill={backfillAlbums}
          missingTitles={songs.filter((s) => s.title && s.title.trim() && !(s.titleEn && s.titleEn.trim())).length}
          onBackfillTitles={backfillTitles} />
      )}
      {view === "add" && <AddSong key={addPrefill || "add"} initialQuery={addPrefill} onBack={() => back()} onCreate={createSong} />}
      {view === "reader" && cur && (
        <Reader song={cur} targetLang={targetLang} onBack={() => back()}
          onEdit={() => (offline ? flash(t("tOffline")) : go("edit"))}
          onPractice={() => go("practice")} onFoundMedia={(patch) => { if (!offline) saveSong(patch); }} />
      )}
      {view === "practice" && cur && <Practice song={cur} onBack={() => back("reader")} />}
      {/* ---- reader & learning ---- */}
      {view === "review" && (
        <Review songs={songs} onBack={() => back()} onOpenSong={(id) => go("reader", { id })} />
      )}
      {view === "vocab" && (
        <Vocab songs={songs} onBack={() => back()} onOpenSong={(id) => go("reader", { id })} />
      )}
      {view === "edit" && cur && (
        <Editor key={cur.id} song={cur} provider={provider} setProvider={setProvider}
          hasOwnKey={hasOwnKey} onSaveKey={saveDeeplKey} targetLang={targetLang}
          onUsage={onUsage} registerGuard={registerGuard}
          isNew={freshIds.current.has(cur.id)} onAbandon={discardSong}
          onBack={() => back("reader")}
          onSave={(patch) => { saveSong(patch); flash(t("tSaved")); back("reader"); }}
          onRemove={() => removeSong(cur.id)} flash={flash} />
      )}
      <Toast toast={toast} />
    </Shell>
  );
}
