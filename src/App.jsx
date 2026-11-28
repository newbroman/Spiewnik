import React, { useEffect, useState } from "react";
import AddSong from "./views/AddSong.jsx";
import Auth from "./views/Auth.jsx";
import Editor from "./views/Editor.jsx";
import Help from "./views/Help.jsx";
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
import Feedback, { openPlayFeedback } from "./views/Feedback.jsx";
import { toastBus } from "./lib/toast.js";
// ---- reader & learning ----
import Review from "./views/Review.jsx";
import Vocab from "./views/Vocab.jsx";

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = checking
  const [songs, setSongs] = useState([]);
  const [profile, setProfile] = useState(null); // { deepl_key, trial_used, target_lang } or null
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("list"); // list | add | reader | edit | practice
  const [curId, setCurId] = useState(null);
  const [provider, setProvider] = useState(() => { try { return localStorage.getItem(PROVIDER_KEY) || "deepl"; } catch { return "deepl"; } });
  const [toast, setToast] = useState("");
  const [showTour, setShowTour] = useState(false);

  const flash = (m) => { setToast(m); clearTimeout(flash._t); flash._t = setTimeout(() => setToast(""), 2800); };

  // Relay toasts raised from any view through the module-level bus.
  useEffect(() => {
    if (!toastBus) return;
    const h = (e) => flash(e.detail);
    toastBus.addEventListener("spiewnik-toast", h);
    return () => toastBus.removeEventListener("spiewnik-toast", h);
  }, []);

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
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s || null);
      setAccessToken(s?.access_token);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // --- Load this person's songs once signed in -------------------------------
  async function loadSongs() {
    setLoading(true);
    const { data, error } = await supabase
      .from("songs").select("*")
      .order("position", { ascending: true }).order("updated_at", { ascending: true });
    if (!error && data) setSongs(data.map(fromRow));
    setLoading(false);
  }
  async function loadProfile() {
    const { data } = await supabase.from("profiles").select("deepl_key,trial_used,target_lang").eq("id", session.user.id).maybeSingle();
    setProfile(data || null);
    setProfileLoaded(true);
  }
  useEffect(() => {
    if (session) { setProfileLoaded(false); loadSongs(); loadProfile(); }
    else { setSongs([]); setProfile(null); setProfileLoaded(false); setLoading(false); }
  }, [session?.user?.id]);

  async function saveDeeplKey(key) {
    const { error } = await supabase.from("profiles").upsert({ id: session.user.id, deepl_key: key || null, updated_at: new Date().toISOString() });
    if (error) { flash("Couldn't save key: " + error.message); return false; }
    await loadProfile();
    flash(key ? t("tKeySaved") : t("tKeyRemoved"));
    return true;
  }
  async function saveTargetLang(name) {
    const { error } = await supabase.from("profiles").upsert({ id: session.user.id, target_lang: name, updated_at: new Date().toISOString() });
    if (error) { flash("Couldn't save: " + error.message); return false; }
    await loadProfile();
    flash(makeT(name)("tTargetSet", { name })); // confirm in the newly chosen language
    return true;
  }
  const hasOwnKey = !!(profile && profile.deepl_key);
  const targetLang = (profile && profile.target_lang) || "English";
  const t = makeT(targetLang); // for toasts fired from App

  useEffect(() => { try { localStorage.setItem(PROVIDER_KEY, provider); } catch {} }, [provider]);

  const cur = songs.find((s) => s.id === curId);

  // --- CRUD against Supabase (RLS scopes every row to this user) -------------
  async function createSong({ language, artist, title, album }) {
    const position = songs.reduce((m, s) => Math.max(m, s.position || 0), 0) + 1;
    const { data, error } = await supabase
      .from("songs").insert({ language, artist, title, album: album || "", pl: "", en: "", position })
      .select().single();
    if (error) { flash("Couldn't add: " + error.message); return; }
    const s = fromRow(data);
    setSongs((p) => [...p, s]);
    setCurId(s.id); setView("edit");
  }

  async function saveSong(patch) {
    if (!curId) return;
    setSongs((prev) => prev.map((s) => (s.id === curId ? { ...s, ...patch } : s))); // optimistic
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
    const { error } = await supabase.from("songs").update(row).eq("id", curId);
    if (error) flash("Save didn't reach the server: " + error.message);
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
  async function backfillTitles() {
    const todo = songs.filter((s) => s.title && s.title.trim() && !(s.titleEn && s.titleEn.trim()));
    let filled = 0;
    for (const s of todo) {
      try {
        const lines = [s.title.trim(), (s.album || "").trim()];
        const r = await fetch("/api/translate", {
          method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
          body: JSON.stringify({ lines, source: langOf(s.language).code, target: langOf(targetLang).code, provider: "deepl" }),
        });
        if (!r.ok) continue;
        const j = await r.json();
        const tr = j.translations || [];
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
    setView("list");
    const { error } = await supabase.from("songs").delete().eq("id", id);
    flash(error ? "Couldn't remove: " + error.message : t("tSongRemoved"));
  }

  if (session === undefined) {
    return <Shell lang={targetLang}><div className="splash">Śpiewnik…</div></Shell>;
  }
  if (session === null) {
    return <Shell lang={targetLang}><Auth flash={flash} /><Toast toast={toast} /></Shell>;
  }
  // Brand-new account: ask once which language to translate into.
  if (profileLoaded && !loading && profile === null && songs.length === 0) {
    return <Shell lang={targetLang}><Welcome onPick={saveTargetLang} /><Toast toast={toast} /></Shell>;
  }

  return (
    <Shell lang={targetLang}>
      {view === "list" && (
        <ListView
          songs={songs} loading={loading} email={session.user.email}
          onOpen={(id) => { setCurId(id); setView("reader"); }}
          onDelete={(id) => removeSong(id)}
          onAdd={() => setView("add")}
          onSettings={() => setView("settings")}
          onSignOut={() => supabase.auth.signOut()}
          onHelp={() => setView("help")}
          onFeedback={openPlayFeedback}
        />
      )}
      {view === "help" && <Help onBack={() => setView("list")} onReplayTour={() => { setView("list"); setShowTour(true); }} />}
      {showTour && <TourOverlay onClose={endTour} onAdd={() => { endTour(); setView("add"); }} />}
      {view === "feedback" && (
        <Feedback email={session.user.email} onBack={() => setView("list")}
          onSent={() => { setView("list"); flash(t("feedbackThanks")); }} />
      )}
      {view === "settings" && (
        <Settings profile={profile} hasOwnKey={hasOwnKey} targetLang={targetLang}
          onSave={saveDeeplKey} onSaveTarget={saveTargetLang} onBack={() => setView("list")}
          missingAlbums={songs.filter((s) => !(s.album && s.album.trim())).length} onBackfill={backfillAlbums}
          missingTitles={songs.filter((s) => s.title && s.title.trim() && !(s.titleEn && s.titleEn.trim())).length}
          onBackfillTitles={backfillTitles} />
      )}
      {view === "add" && <AddSong onBack={() => setView("list")} onCreate={createSong} />}
      {view === "reader" && cur && (
        <Reader song={cur} targetLang={targetLang} onBack={() => setView("list")} onEdit={() => setView("edit")}
          onPractice={() => setView("practice")} onFoundMedia={(patch) => saveSong(patch)} />
      )}
      {view === "practice" && cur && <Practice song={cur} onBack={() => setView("reader")} />}
      {/* ---- reader & learning ---- */}
      {view === "review" && (
        <Review songs={songs} onBack={() => setView("list")} onOpenSong={(id) => { setCurId(id); setView("reader"); }} />
      )}
      {view === "vocab" && (
        <Vocab songs={songs} onBack={() => setView("list")} onOpenSong={(id) => { setCurId(id); setView("reader"); }} />
      )}
      {view === "edit" && cur && (
        <Editor song={cur} provider={provider} setProvider={setProvider}
          hasOwnKey={hasOwnKey} onSaveKey={saveDeeplKey} targetLang={targetLang}
          onBack={() => setView("reader")}
          onSave={(patch) => { saveSong(patch); setView("reader"); flash(t("tSaved")); }}
          onRemove={() => removeSong(cur.id)} flash={flash} />
      )}
      <Toast toast={toast} />
    </Shell>
  );
}
