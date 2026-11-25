import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase, setAccessToken, apiHeaders } from "./supabase.js";
import { makeT } from "./i18n.js";

// UI language follows the user's chosen target language, via this context.
const I18n = React.createContext(makeT("English"));
const useT = () => React.useContext(I18n);

// A tiny toast bus so any view (not just those handed `flash`) can raise one.
// The App subscribes once and relays through its own `flash`.
const toastBus = typeof window !== "undefined" ? new EventTarget() : null;
const flashGlobal = (m) => { try { toastBus && toastBus.dispatchEvent(new CustomEvent("spiewnik-toast", { detail: m })); } catch {} };
// If an OpenAI-backed call was refused for hitting the monthly cap (HTTP 429),
// show a friendly toast and tell the caller to stop. `tr` is the view's translator.
function aiCapHit(r, tr) {
  if (r && r.status === 429) { flashGlobal(tr("aiLimit")); return true; }
  return false;
}

// ============================================================================
//  Śpiewnik — learn a language through song lyrics, line by line.
//
//  Each person signs in and keeps their OWN private library: any artist, any
//  language. Paste a song's original lyric and its English line-for-line, read
//  them side by side, hear the track (YouTube / Spotify), and practise saying
//  the lines aloud. Content lives in your account (Supabase), protected row by
//  row so no one else can see your songs.
// ============================================================================

// Languages offered for a new song. `code` is the translation source code
// (DeepL/Google); `bcp` drives text-to-speech and speech recognition.
const LANGS = [
  { name: "English", code: "EN", bcp: "en-GB" },
  { name: "Polish", code: "PL", bcp: "pl-PL" },
  { name: "Spanish", code: "ES", bcp: "es-ES" },
  { name: "French", code: "FR", bcp: "fr-FR" },
  { name: "German", code: "DE", bcp: "de-DE" },
  { name: "Italian", code: "IT", bcp: "it-IT" },
  { name: "Portuguese", code: "PT", bcp: "pt-PT" },
  { name: "Dutch", code: "NL", bcp: "nl-NL" },
  { name: "Russian", code: "RU", bcp: "ru-RU" },
  { name: "Ukrainian", code: "UK", bcp: "uk-UA" },
  { name: "Czech", code: "CS", bcp: "cs-CZ" },
  { name: "Swedish", code: "SV", bcp: "sv-SE" },
  { name: "Norwegian", code: "NB", bcp: "nb-NO" },
  { name: "Danish", code: "DA", bcp: "da-DK" },
  { name: "Finnish", code: "FI", bcp: "fi-FI" },
  { name: "Greek", code: "EL", bcp: "el-GR" },
  { name: "Turkish", code: "TR", bcp: "tr-TR" },
  { name: "Japanese", code: "JA", bcp: "ja-JP" },
  { name: "Korean", code: "KO", bcp: "ko-KR" },
  { name: "Chinese", code: "ZH", bcp: "zh-CN" },
];
const langOf = (name) => LANGS.find((l) => l.name === name) || LANGS[0];

// Native word for "song" in each song language — appended to a web search to
// broaden it beyond the catalogue (e.g. "Kaśka Sochocka piosenka").
const SONG_WORD = {
  English: "song", Polish: "piosenka", Spanish: "canción", French: "chanson",
  German: "Lied", Italian: "canzone", Portuguese: "canção", Dutch: "lied",
  Russian: "песня", Ukrainian: "пісня", Czech: "píseň", Swedish: "låt",
  Norwegian: "sang", Danish: "sang", Finnish: "laulu", Greek: "τραγούδι",
  Turkish: "şarkı", Japanese: "歌", Korean: "노래", Chinese: "歌曲",
};
const songWordOf = (name) => SONG_WORD[name] || "song";

const PLAYER_KEY = "spiewnik.player.v1";
const PROVIDER_KEY = "spiewnik.provider.v1";

const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const esc = (s) => s || "";
// Split on every line-break variant, not just \n — pasted text (phones, PDFs,
// some sites) often uses \r, \r\n or the Unicode line/paragraph separators.
const SPLIT_RE = new RegExp("\\r\\n|\\r|\\n|\\u2028|\\u2029");
// Normalise any of those to \n so stored lyrics always split cleanly later.
const normLines = (s) => (s || "").replace(new RegExp("\\r\\n|\\r|\\u2028|\\u2029", "g"), "\n");
// Strip the "copied from" footer lyric sites append (teksciory, azlyrics, …).
const stripFooter = (s) =>
  (s || "")
    .replace(/\n?\s*Czytaj więcej na[\s\S]*$/i, "")
    .replace(/\n?\s*Read more at[\s\S]*$/i, "")
    .replace(/\s*https?:\/\/\S*utm_source=paste\S*/gi, "")
    .trim();

// The original owner — the only account the one-time Daria import is offered to.

// Map a DB row to the shape the UI uses (camelCase for media ids).
const fromRow = (r) => ({
  id: r.id, language: r.language || "Polish", artist: r.artist || "", album: r.album || "", title: r.title || "",
  titleEn: r.title_en || "", albumEn: r.album_en || "",
  pl: r.pl || "", en: r.en || "", youtubeId: r.youtube_id, spotifyId: r.spotify_id, position: r.position ?? 0,
});

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
          onFeedback={() => setView("feedback")}
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

function Shell({ lang, children }) {
  return (
    <div className="kl-root">
      <style>{CSS}</style>
      <I18n.Provider value={makeT(lang || "English")}>
        <div className="app">{children}</div>
      </I18n.Provider>
    </div>
  );
}
function Toast({ toast }) {
  return <div className={"kl-toast" + (toast ? " show" : "")}>{toast}</div>;
}

// ---- Sign in / sign up ------------------------------------------------------
function Auth({ flash }) {
  const t = useT();
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [showPw, setShowPw] = useState(false);

  const submit = async () => {
    if (busy) return;
    const e = email.trim();
    if (!e || !pw) { setErr("Enter your email and a password."); return; }
    setBusy(true); setErr(""); setNote("");
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: e, password: pw });
        if (error) throw error;
        if (!data.session) {
          setNote("Account created. Check your email for a confirmation link, then sign in.");
          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: e, password: pw });
        if (error) throw error;
      }
    } catch (ex) {
      setErr(ex.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock">
      <div className="lockcard">
        <div className="eyebrow">{t("tagline")}</div>
        <h1>Śpiewnik</h1>
        <p>{mode === "signup" ? t("subSignUp") : t("subSignIn")}</p>
        <input type="email" value={email} autoFocus placeholder={t("email")} autoComplete="email"
          onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <div className="pwwrap">
          <input type={showPw ? "text" : "password"} value={pw} placeholder={t("password")}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          <button type="button" className="pweye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? t("hide") : t("show")}>{showPw ? t("hide") : t("show")}</button>
        </div>
        {err && <div className="lockerr">{err}</div>}
        {note && <div className="locknote">{note}</div>}
        <button onClick={submit} disabled={busy}>
          {busy ? "…" : mode === "signup" ? t("btnCreate") : t("btnSignIn")}
        </button>
        <button className="linkbtn" onClick={() => { setErr(""); setNote(""); setMode(mode === "signup" ? "signin" : "signup"); }}>
          {mode === "signup" ? t("toSignIn") : t("toSignUp")}
        </button>
      </div>
    </div>
  );
}

// ---- First-run welcome: pick the language to translate into ----------------
function Welcome({ onPick }) {
  const t = useT();
  const [lang, setLang] = useState("English");
  const [busy, setBusy] = useState(false);
  const go = async () => { if (busy) return; setBusy(true); await onPick(lang); };
  // Preview the chosen language live as they pick it.
  const tp = makeT(lang);
  return (
    <div className="lock">
      <div className="lockcard">
        <div className="eyebrow">{tp("wEyebrow")}</div>
        <h1>{tp("wTitle")}</h1>
        <p>{tp("wBody")}</p>
        <select className="welcomesel" value={lang} onChange={(e) => setLang(e.target.value)}>
          {LANGS.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
        </select>
        <button onClick={go} disabled={busy}>{busy ? "…" : tp("cont")}</button>
      </div>
    </div>
  );
}

// ---- Library list -----------------------------------------------------------
function ListView({ songs, loading, email, onOpen, onDelete, onAdd, onSettings, onSignOut, onHelp, onFeedback }) {
  const t = useT();
  const [confirmDel, setConfirmDel] = useState(null); // song id awaiting delete confirmation
  const [selArtist, setSelArtist] = useState(null); // drilled-in artist: { language, key } or null
  const [openAl, setOpenAl] = useState({});  // collapsed albums on the artist page (default open)
  const [query, setQuery] = useState("");    // library lyric/word search
  // Index by language, then by artist within each language.
  const byLang = [];
  songs.forEach((s) => {
    const L = s.language || "Other";
    let lg = byLang.find((x) => x.language === L);
    if (!lg) { lg = { language: L, artists: [] }; byLang.push(lg); }
    const A = (s.artist && s.artist.trim()) || t("unknownArtist");
    const key = A.toLowerCase();
    let ar = lg.artists.find((x) => x.key === key);
    if (!ar) { ar = { key, artist: A, albums: [] }; lg.artists.push(ar); }
    // Prefer a label that starts with a capital (e.g. "Zalia" over "zalia").
    else if (A.charAt(0) === A.charAt(0).toUpperCase() && ar.artist.charAt(0) !== ar.artist.charAt(0).toUpperCase()) ar.artist = A;
    // Group by album within the artist. Blank album = loose singles (no header).
    const AL = (s.album && s.album.trim()) || "";
    const alKey = AL.toLowerCase();
    let al = ar.albums.find((x) => x.key === alKey);
    if (!al) { al = { key: alKey, album: AL, items: [] }; ar.albums.push(al); }
    else if (AL.charAt(0) === AL.charAt(0).toUpperCase() && al.album.charAt(0) !== al.album.charAt(0).toUpperCase()) al.album = AL;
    al.items.push(s);
  });
  byLang.sort((a, b) => a.language.localeCompare(b.language));
  byLang.forEach((lg) => {
    lg.artists.sort((a, b) => a.artist.localeCompare(b.artist));
    // Named albums first (A–Z), loose singles (blank album) last; songs A–Z within each.
    lg.artists.forEach((ar) => {
      ar.albums.sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1) || a.album.localeCompare(b.album));
      ar.albums.forEach((al) => al.items.sort((a, b) => (a.title || "").localeCompare(b.title || "")));
    });
  });
  const done = songs.filter((s) => s.pl && s.pl.trim()).length;

  // One song row: tap the body to open it, or the bin to delete (with an inline confirm).
  const songRow = (s, i) => {
    const filled = !!(s.pl && s.pl.trim());
    return (
      <div key={s.id} className="songrow">
        <button className="song" onClick={() => onOpen(s.id)}>
          <span className="num">{i + 1}</span>
          <span className="meta">
            <h3>{s.title || t("untitled")}</h3>
            <p>{filled ? t("lines", { n: s.pl.split(SPLIT_RE).filter((l) => l.trim()).length }) : t("noLyricsYet")}</p>
          </span>
          <span className={"dot " + (filled ? "full" : "empty")} />
        </button>
        {confirmDel === s.id ? (
          <span className="songdelask">
            <button className="songdel yes" onClick={() => { onDelete(s.id); setConfirmDel(null); }}>{t("del")}</button>
            <button className="songdel no" onClick={() => setConfirmDel(null)}>{t("keep")}</button>
          </span>
        ) : (
          <button className="songdel" aria-label={t("removeSong")} title={t("removeSong")}
            onClick={() => setConfirmDel(s.id)}>🗑</button>
        )}
      </div>
    );
  };

  // Drilled-in artist (master → detail): resolve the selection against the fresh grouping.
  const curLg = selArtist ? byLang.find((l) => l.language === selArtist.language) : null;
  const curAr = curLg ? curLg.artists.find((a) => a.key === selArtist.key) : null;

  // Library word-search: match a remembered lyric (or title/artist) across songs,
  // diacritic-insensitive so Polish matches with or without accents.
  const nq = norm(query);
  const matches = nq
    ? songs
        .map((s) => {
          let snip = "";
          for (const l of (s.pl || "").split(SPLIT_RE).concat((s.en || "").split(SPLIT_RE))) {
            if (norm(l).includes(nq)) { snip = l.trim(); break; }
          }
          const metaHit =
            norm(s.title).includes(nq) || norm(s.artist).includes(nq) || norm(s.album || "").includes(nq);
          return snip || metaHit ? { s, snip } : null;
        })
        .filter(Boolean)
        .sort((a, b) =>
          (a.s.artist || "").localeCompare(b.s.artist || "") || (a.s.title || "").localeCompare(b.s.title || "")
        )
    : [];

  return (
    <>
      <div className="top">
        <div className="toprow">
          <div className="eyebrow">{t("libraryEyebrow")}</div>
          <div className="topbtns">
            <button className="signout" onClick={onHelp}>{t("help")}</button>
            <button className="signout accent" onClick={onFeedback}>{t("feedback")}</button>
            <button className="signout" onClick={onSettings}>{t("settings")}</button>
            <button className="signout" onClick={onSignOut}>{t("signOut")}</button>
          </div>
        </div>
        <h1>Śpiewnik</h1>
        <p>{songs.length === 0
          ? t("emptyIntro")
          : `${t("filled", { done, total: songs.length })} ${t("signedInAs", { email })}`}</p>
      </div>
      <div className="body">
        {!loading && songs.length > 0 && (
          <div className="libsearch">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("searchLibraryPh")} />
            {query && <button className="libsearchx" onClick={() => setQuery("")} aria-label={t("keep")}>✕</button>}
          </div>
        )}
        {loading ? (
          <div className="emptylib">{t("loading")}</div>
        ) : songs.length === 0 ? (
          <div className="emptyhero">
            <div className="emptyicon">♪</div>
            <h3>{t("emptyTitle")}</h3>
            <p>{t("emptyBody")}</p>
            <button className="add big" onClick={onAdd}>{t("addFirst")}</button>
            <button className="emptyhelp" onClick={onHelp}>{t("emptyHow")}</button>
          </div>
        ) : query.trim() ? (
          matches.length === 0 ? (
            <div className="emptylib">{t("noLyricHits")}</div>
          ) : (
            matches.map(({ s, snip }) => (
              <button key={s.id} className="song lyrichit" onClick={() => onOpen(s.id)}>
                <span className="meta">
                  <h3>{s.title || t("untitled")}</h3>
                  <p className="hitsub">{[s.artist, s.language].filter(Boolean).join(" · ")}</p>
                  {snip && <p className="hitsnip">{esc(snip)}</p>}
                </span>
              </button>
            ))
          )
        ) : curAr ? (
          <>
            <button className="artback" onClick={() => setSelArtist(null)}>← {t("allArtists")}</button>
            <div className="albsect">{curLg.language}</div>
            <h2 className="artpagetitle">{curAr.artist}</h2>
            {curAr.albums.map((al) => {
              const alKey = selArtist.language + "|" + selArtist.key + "|" + (al.key || "_loose");
              const alOpen = openAl[alKey] === undefined ? true : openAl[alKey];
              return (
                <div key={al.key || "_loose"} className="albgroup">
                  <button className={"albbtn" + (alOpen ? " open" : "")} aria-expanded={alOpen}
                    onClick={() => setOpenAl((o) => ({ ...o, [alKey]: !(o[alKey] === undefined ? true : o[alKey]) }))}>
                    <span className="chev">▸</span>
                    <span className={"artname" + (al.key ? "" : " noalbum")}>{al.album || t("noAlbum")}</span>
                    <span className="count">{al.items.length}</span>
                  </button>
                  {alOpen && <div className="songs">{al.items.map((s, i) => songRow(s, i))}</div>}
                </div>
              );
            })}
          </>
        ) : (
          byLang.map((lg) => (
            <div key={lg.language}>
              <div className="albsect">{lg.language}</div>
              {lg.artists.map((ar) => {
                const nSongs = ar.albums.reduce((n, al) => n + al.items.length, 0);
                return (
                  <button key={ar.artist} className="artbtn drill"
                    onClick={() => { setSelArtist({ language: lg.language, key: ar.key }); setConfirmDel(null); }}>
                    <span className="artname">{ar.artist}</span>
                    <span className="count">{nSongs}</span>
                    <span className="chev go">›</span>
                  </button>
                );
              })}
            </div>
          ))
        )}
        <div className="addrow"><button className="add" onClick={onAdd}>{t("addSongPlus")}</button></div>
      </div>
    </>
  );
}

// ---- Add a song (search, pick, or add manually) ----------------------------
function AddSong({ onBack, onCreate }) {
  const t = useT();
  const [language, setLanguage] = useState("Polish");
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [creating, setCreating] = useState(false);
  const [manual, setManual] = useState(false);
  const [artist, setArtist] = useState("");
  const [album, setAlbum] = useState("");
  const [title, setTitle] = useState("");
  const [voiceRec, setVoiceRec] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMode, setAiMode] = useState(false);    // current results came from AI
  const [openai, setOpenai] = useState(false);     // OPENAI key present → voice + AI offered
  const vMediaRef = useRef(null), vStreamRef = useRef(null), vChunksRef = useRef([]);

  // Voice search and AI suggestions both need the OpenAI key; check once.
  useEffect(() => {
    let ok = true;
    fetch("/api/suggest", { headers: apiHeaders() }).then((r) => r.json())
      .then((j) => { if (ok) setOpenai(!!(j && j.configured)); }).catch(() => {});
    return () => { ok = false; };
  }, []);

  const seqRef = useRef(0);
  async function runSearch(query) {
    const my = ++seqRef.current;
    // A pasted Spotify/YouTube link goes to the resolver; anything else is a catalogue search.
    const isLink = /^https?:\/\/\S+$/i.test(query) && /(spotify\.com|youtu\.be|youtube\.com)/i.test(query);
    const endpoint = isLink
      ? `/api/resolve?url=${encodeURIComponent(query)}`
      : `/api/search?q=${encodeURIComponent(query)}`;
    setBusy(true); setSearched(true); setAiMode(false);
    try {
      const r = await fetch(endpoint, { headers: apiHeaders() });
      const j = await r.json();
      if (my !== seqRef.current) return;              // a newer search superseded this one
      setResults(Array.isArray(j.results) ? j.results : []);
    } catch { if (my === seqRef.current) setResults([]); }
    finally { if (my === seqRef.current) setBusy(false); }
  }
  function doSearch() { const query = q.trim(); if (query) runSearch(query); }

  // AI suggestions — turn a theme / vague request into a list of real songs.
  async function askAI() {
    const query = q.trim();
    if (aiBusy || !query) return;
    seqRef.current++;                                  // cancel any pending live search
    setAiBusy(true); setSearched(true);
    try {
      const r = await fetch("/api/suggest", {
        method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
        body: JSON.stringify({ query, language }),
      });
      if (aiCapHit(r, t)) { setResults([]); return; }
      const j = await r.json();
      setResults(Array.isArray(j.results) ? j.results : []);
      setAiMode(true);
    } catch { setResults([]); } finally { setAiBusy(false); }
  }

  // Voice search — speak a query, transcribe it with Whisper, drop it in the box
  // (the live search then runs automatically).
  async function toggleVoice() {
    if (voiceRec) {
      try { if (vMediaRef.current && vMediaRef.current.state !== "inactive") vMediaRef.current.stop(); } catch {}
      setVoiceRec(false);
      return;
    }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return; }
    vStreamRef.current = stream; vChunksRef.current = [];
    const mime = window.MediaRecorder?.isTypeSupported("audio/webm") ? "audio/webm"
      : window.MediaRecorder?.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
    let mr;
    try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
    catch { stream.getTracks().forEach((t) => t.stop()); return; }
    vMediaRef.current = mr;
    const chunks = vChunksRef.current;
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      try { vStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
      setVoiceRec(false);
      const blob = new Blob(chunks, { type: mime || "audio/webm" });
      if (!blob.size) return;
      setBusy(true);
      try {
        const b64 = await blobToBase64(blob);
        const r = await fetch("/api/transcribe", {
          method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
          body: JSON.stringify({ audio: b64, mime: mime || "audio/webm", language: langOf(language).bcp.slice(0, 2) }),
        });
        if (aiCapHit(r, t)) return;
        const j = await r.json();
        const txt = (j.text || "").trim();
        if (txt) setQ(txt);                            // live search fires on the new query
      } catch {} finally { setBusy(false); }
    };
    mr.start(); setVoiceRec(true);
    setTimeout(() => { try { if (mr.state !== "inactive") mr.stop(); } catch {} }, 6000); // short query cap
  }

  // Live search: fetch a list automatically as you type (debounced). A half-typed
  // link is left for Enter / the button so we don't resolve it prematurely.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { seqRef.current++; setResults([]); setSearched(false); return; }
    if (/^https?:\/\//i.test(query)) return;
    const id = setTimeout(() => runSearch(query), 450);
    return () => clearTimeout(id);
  }, [q]);
  async function pick(res) {
    if (creating) return;
    setCreating(true);
    await onCreate({ language, artist: res.artist, album: res.album || "", title: res.title });
  }
  async function createManual() {
    if (!title.trim() || creating) return;
    setCreating(true);
    await onCreate({ language, artist: artist.trim(), album: album.trim(), title: title.trim() });
  }
  const webUrl = "https://www.google.com/search?q=" +
    encodeURIComponent(`${q.trim()} ${songWordOf(language)}`.trim());

  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>{t("addTitle")}</h2><p>{t("addSub")}</p></div>
      </div>
      <div className="editor">
        <div className="addlang">
          <label>{t("songLang")}</label>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGS.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </div>

        {!manual ? (
          <>
            <label className="searchlabel">{t("searchHdr")}</label>
            <div className="searchrow">
              <input value={q} autoFocus placeholder={t("searchPh")}
                onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doSearch()} />
              {openai && (
                <button className={"micbtn" + (voiceRec ? " on" : "")} onClick={toggleVoice} aria-label={t("voiceSearch")} title={t("voiceSearch")}>
                  {voiceRec ? "⏹" : "🎤"}
                </button>
              )}
              <button className="searchbtn" onClick={doSearch} disabled={busy || !q.trim()}>{busy ? "…" : t("search")}</button>
            </div>
            <p className="searchtip">{t("linkTip")}</p>
            {openai && q.trim() && (
              <button className="aibtn" onClick={askAI} disabled={aiBusy}>{aiBusy ? t("aiBusy") : t("aiSuggest")}</button>
            )}

            <div className="results">
              {aiMode && results.length > 0 && <p className="ailabel">{t("aiLabel")}</p>}
              {results.map((r, i) => (
                <button key={i} className="sresult" onClick={() => pick(r)} disabled={creating}>
                  <span className="meta">
                    <h3>{r.title}</h3>
                    <p>{[r.artist, r.album, r.year].filter(Boolean).join(" · ")}</p>
                  </span>
                  <span className="pickarrow">＋</span>
                </button>
              ))}
              {searched && !busy && results.length === 0 && (
                <div className="noresults">{t("noMatches")}</div>
              )}
            </div>

            {q.trim() && (
              <div className="webfindwrap">
                <a className="webfind" href={webUrl} target="_blank" rel="noreferrer">{t("webSearch")}</a>
                <p className="webfindhint">{t("webSearchHint")}</p>
              </div>
            )}

            <button className="manuallink" onClick={() => setManual(true)}>{t("addManual")}</button>
          </>
        ) : (
          <>
            <div className="addform">
              <div><label>{t("artist")}</label>
                <input value={artist} placeholder="e.g. Daria ze Śląska" onChange={(e) => setArtist(e.target.value)} /></div>
              <div><label>{t("album")} <span className="opt">{t("optional")}</span></label>
                <input value={album} placeholder={t("album")} onChange={(e) => setAlbum(e.target.value)} /></div>
              <div><label>{t("title")}</label>
                <input value={title} autoFocus placeholder={t("title")} onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createManual()} /></div>
            </div>
            <div className="actions">
              <button className="save" onClick={createManual} disabled={creating}>{creating ? t("adding") : t("addPaste")}</button>
              <button className="cancel" onClick={() => setManual(false)}>{t("backSearch")}</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ---- Settings (your own DeepL key) -----------------------------------------
function Settings({ profile, hasOwnKey, targetLang, onSave, onSaveTarget, onBack, missingAlbums, onBackfill, missingTitles, onBackfillTitles }) {
  const t = useT();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [bfBusy, setBfBusy] = useState(false);
  const [bfMsg, setBfMsg] = useState("");
  const [btBusy, setBtBusy] = useState(false);
  const [btMsg, setBtMsg] = useState("");
  const used = profile?.trial_used || 0;
  const save = async () => { if (!key.trim() || busy) return; setBusy(true); const ok = await onSave(key.trim()); setBusy(false); if (ok) setKey(""); };
  const remove = async () => { setBusy(true); await onSave(""); setBusy(false); };
  const runBackfill = async () => {
    if (bfBusy) return;
    setBfBusy(true); setBfMsg("");
    const { total, filled } = await onBackfill();
    setBfBusy(false); setBfMsg(t("albumsFilled", { filled, total }));
  };
  const runBackfillTitles = async () => {
    if (btBusy) return;
    setBtBusy(true); setBtMsg("");
    const { total, filled } = await onBackfillTitles();
    setBtBusy(false); setBtMsg(t("titlesDone", { filled, total }));
  };
  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>{t("settings")}</h2><p>{t("settingsSub")}</p></div>
      </div>
      <div className="editor">
        <div className="setcard" style={{ marginBottom: 16 }}>
          <h3>{t("translateInto")}</h3>
          <p className="setstate">{t("translateIntoBody")}</p>
          <select value={targetLang || "English"} onChange={(e) => onSaveTarget(e.target.value)}>
            {LANGS.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </div>
        <div className="setcard">
          <h3>{t("yourKey")}</h3>
          {hasOwnKey ? (
            <p className="setstate ok">{t("keySetOk")}</p>
          ) : (
            <p className="setstate">{t("onShared", { used })}</p>
          )}
          <div className="pwfield">
            <input type={showKey ? "text" : "password"} value={key} placeholder={hasOwnKey ? t("enterNewKey") : t("pasteApiKey")}
              onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
            <button type="button" className="pweye" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? t("hide") : t("show")}>{showKey ? t("hide") : t("show")}</button>
          </div>
          <div className="setbtns">
            <button className="save" onClick={save} disabled={busy || !key.trim()}>{busy ? t("saving") : t("saveKey")}</button>
            {hasOwnKey && <button className="cancel" onClick={remove} disabled={busy}>{t("remove")}</button>}
          </div>
          <a className="findbtn" href="https://www.deepl.com/pro-api" target="_blank" rel="noreferrer">{t("getKey")}</a>
          <p className="hint2">{t("deeplHint")}</p>
        </div>

        {(missingAlbums > 0 || bfMsg) && (
          <div className="setcard" style={{ marginTop: 16 }}>
            <h3>{t("fixAlbumsH")}</h3>
            <p className="setstate">{t("fixAlbumsBody", { n: missingAlbums })}</p>
            <div className="setbtns">
              <button className="save" onClick={runBackfill} disabled={bfBusy || missingAlbums === 0}>
                {bfBusy ? t("fixAlbumsBusy") : t("fixAlbumsBtn")}
              </button>
            </div>
            {bfMsg && <p className="setstate ok">{bfMsg}</p>}
          </div>
        )}

        {(missingTitles > 0 || btMsg) && (
          <div className="setcard" style={{ marginTop: 16 }}>
            <h3>{t("transTitlesH")}</h3>
            <p className="setstate">{t("transTitlesBody", { n: missingTitles })}</p>
            <div className="setbtns">
              <button className="save" onClick={runBackfillTitles} disabled={btBusy || missingTitles === 0}>
                {btBusy ? t("transTitlesBusy") : t("transTitlesBtn")}
              </button>
            </div>
            {btMsg && <p className="setstate ok">{btMsg}</p>}
          </div>
        )}
      </div>
    </>
  );
}

function TourOverlay({ onClose, onAdd }) {
  const t = useT();
  const [i, setI] = useState(0);
  const slides = [
    { ic: "🎵", h: t("tour1H"), b: t("tour1B") },
    { ic: "➕", h: t("tour2H"), b: t("tour2B") },
    { ic: "🔤", h: t("tour3H"), b: t("tour3B") },
    { ic: "🎤", h: t("tour4H"), b: t("tour4B") },
  ];
  const last = i === slides.length - 1;
  const s = slides[i];
  return (
    <div className="tourwrap" role="dialog" aria-modal="true">
      <div className="tourcard">
        <button className="tourskip" onClick={onClose}>{t("tourSkip")}</button>
        <div className="touricon">{s.ic}</div>
        <h2>{s.h}</h2>
        <p>{s.b}</p>
        <div className="tourdots">{slides.map((_, k) => <span key={k} className={k === i ? "on" : ""} />)}</div>
        <div className="tournav">
          {i > 0 && <button className="pracbtn" onClick={() => setI(i - 1)}>{t("prev")}</button>}
          {last
            ? <button className="add" onClick={onAdd}>{t("tourAdd")}</button>
            : <button className="add" onClick={() => setI(i + 1)}>{t("tourNext")}</button>}
        </div>
      </div>
    </div>
  );
}

function Help({ onBack, onReplayTour }) {
  const t = useT();
  const items = ["HowItWorks", "Add", "Lyrics", "Translate", "Read", "Immersive", "Play", "Practice", "Copyright", "Downloads"];
  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>{t("help")}</h2><p>{t("helpSub")}</p></div>
      </div>
      <div className="editor">
        {items.map((k, i) => (
          <div className="setcard" key={k} style={{ marginBottom: 12 }}>
            <h3>{i + 1} · {t("help" + k + "H")}</h3>
            <p className="setstate">{t("help" + k + "B")}</p>
          </div>
        ))}
        {onReplayTour && (
          <button className="manuallink" onClick={onReplayTour}>{t("replayTour")}</button>
        )}
      </div>
    </>
  );
}

function Feedback({ email, onBack, onSent }) {
  const t = useT();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const send = async () => {
    if (!msg.trim() || busy) return;
    setBusy(true); setErr(false);
    const { error } = await supabase.from("feedback").insert({ message: msg.trim(), email });
    setBusy(false);
    if (error) setErr(true); else onSent();
  };
  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>{t("feedback")}</h2><p>{t("feedbackSub")}</p></div>
      </div>
      <div className="editor">
        <div className="setcard">
          <p className="setstate">{t("feedbackIntro")}</p>
          <textarea className="fbarea" value={msg} rows={6} placeholder={t("feedbackPlaceholder")}
            onChange={(e) => setMsg(e.target.value)} />
          {err && <p className="setstate" style={{ color: "var(--rose)" }}>{t("feedbackErr")}</p>}
          <div className="setbtns">
            <button className="save" onClick={send} disabled={busy || !msg.trim()}>{busy ? t("saving") : t("feedbackSend")}</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ---- Reader (side-by-side + player + auto-scroll) ---------------------------
function Reader({ song, targetLang, onBack, onEdit, onPractice, onFoundMedia }) {
  const t = useT();
  const pl = (song.pl || "").split(SPLIT_RE);
  const en = (song.en || "").split(SPLIT_RE);
  const n = Math.max(pl.length, en.length);
  const has = song.pl && song.pl.trim();
  const [yt, setYt] = useState(song.youtubeId ?? undefined);
  const [sp, setSp] = useState(song.spotifyId ?? undefined);
  const [source, setSource] = useState(() => { try { return localStorage.getItem(PLAYER_KEY) || "youtube"; } catch { return "youtube"; } });

  // Start a freshly opened song at the very top — the SPA otherwise keeps the
  // previous scroll position, landing you mid-song under the sticky player.
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [song.id]);

  useEffect(() => {
    let active = true;
    setYt(song.youtubeId ?? undefined);
    setSp(song.spotifyId ?? undefined);
    const resolve = async (api, cached, setter, field) => {
      if (cached !== undefined && cached !== null) return;
      try {
        const r = await fetch(`${api}?title=${encodeURIComponent(song.title)}&artist=${encodeURIComponent(song.artist || "")}`, { headers: apiHeaders() });
        if (!r.ok || !active) return;
        const j = await r.json();
        if (!active) return;
        const id = j && j.id ? j.id : "none";
        setter(id);
        onFoundMedia({ [field]: id });
      } catch { /* leave hidden */ }
    };
    resolve("/api/youtube", song.youtubeId, setYt, "youtubeId");
    resolve("/api/spotify", song.spotifyId, setSp, "spotifyId");
    return () => { active = false; };
  }, [song.id]);

  const ytOk = yt && yt !== "none";
  const spOk = sp && sp !== "none";
  const avail = [ytOk && "youtube", spOk && "spotify"].filter(Boolean);
  const eff = avail.includes(source) ? source : avail[0];
  const pick = (s) => { setSource(s); try { localStorage.setItem(PLAYER_KEY, s); } catch {} };

  const [autoScroll, setAutoScroll] = useState(false);
  const [immersive, setImmersive] = useState(false);   // hide the translation; tap a line to reveal
  const [revealed, setRevealed] = useState({});        // line indices peeked in immersive mode
  const [emoji, setEmoji] = useState(null);            // emoji per line, or null when off
  const [emojiBusy, setEmojiBusy] = useState(false);
  const [illustOk, setIllustOk] = useState(false);     // OpenAI key present → emoji anchors offered

  useEffect(() => {
    let ok = true;
    fetch("/api/illustrate", { headers: apiHeaders() }).then((r) => r.json())
      .then((j) => { if (ok) setIllustOk(!!(j && j.configured)); }).catch(() => {});
    return () => { ok = false; };
  }, []);

  const illustrate = async () => {
    if (emojiBusy) return;
    if (emoji) { setEmoji(null); return; }              // toggle the anchors off
    setEmojiBusy(true);
    try {
      const r = await fetch("/api/illustrate", {
        method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
        body: JSON.stringify({ lines: pl.map((l) => l.trim()), language: song.language }),
      });
      if (aiCapHit(r, t)) return;
      const j = await r.json();
      if (Array.isArray(j.emoji)) setEmoji(j.emoji);
    } catch {} finally { setEmojiBusy(false); }
  };
  const [scrollSpeed, setScrollSpeed] = useState(8);
  useEffect(() => {
    if (!autoScroll) return;
    let raf, last = performance.now(), acc = 0;
    const step = (now) => {
      acc += ((now - last) / 1000) * scrollSpeed; last = now;
      if (acc >= 1) {
        const px = Math.floor(acc); acc -= px;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        const next = Math.min(max, window.scrollY + px);
        window.scrollTo(0, next);
        if (next >= max) { setAutoScroll(false); return; }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [autoScroll, scrollSpeed]);

  return (
    <>
      <div className="rhead2">
        <div className="rbar">
          <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
          <div className="ttl">
            <h2>{song.title}</h2>
            {song.titleEn && norm(song.titleEn) !== norm(song.title) && <p className="ttltrans">{song.titleEn}</p>}
            <p>{[song.artist,
                 song.album ? song.album + (song.albumEn && norm(song.albumEn) !== norm(song.album) ? ` (${song.albumEn})` : "") : "",
                 song.language].filter(Boolean).join(" · ")}</p>
          </div>
          {has ? <button className="icbtn" onClick={onPractice}>{t("practice")}</button> : null}
          <button className="icbtn accent" onClick={onEdit}>{t("edit")}</button>
        </div>
        {avail.length > 0 && (
          <div className="playerbox">
            <div className="plcontrols">
              {avail.length > 1 ? (
                <div className="srctoggle">
                  <button className={eff === "youtube" ? "on" : ""} onClick={() => pick("youtube")}>YouTube</button>
                  <button className={eff === "spotify" ? "on" : ""} onClick={() => pick("spotify")}>Spotify</button>
                </div>
              ) : <span />}
              <div className="ascroll">
                {autoScroll && (
                  <>
                    <button className="asstep" aria-label="Slower" onClick={() => setScrollSpeed((s) => Math.max(2, s - 3))}>−</button>
                    <button className="asstep" aria-label="Faster" onClick={() => setScrollSpeed((s) => Math.min(44, s + 3))}>+</button>
                  </>
                )}
                <button className={"autoscroll" + (autoScroll ? " on" : "")} onClick={() => setAutoScroll((v) => !v)}>
                  {autoScroll ? t("autoScroll") + " ●" : t("autoScroll")}
                </button>
              </div>
            </div>
            {eff === "youtube" ? (
              <iframe key={yt} className="yt" title="YouTube player"
                src={`https://www.youtube.com/embed/${yt}?rel=0`} loading="lazy" allowFullScreen
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" />
            ) : (
              <iframe className="spotify" title="Spotify player"
                src={`https://open.spotify.com/embed/track/${sp}`} width="100%" height="152" loading="lazy"
                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />
            )}
          </div>
        )}
      </div>
      <div className="sheet">
        {has && (
          <div className="sheettools">
            <button className={"stool" + (immersive ? " on" : "")} onClick={() => setImmersive((v) => !v)}>{t("immersive")}</button>
            {illustOk && (
              <button className={"stool" + (emoji ? " on" : "")} onClick={illustrate} disabled={emojiBusy}>
                {emojiBusy ? "…" : t("illustrate")}
              </button>
            )}
          </div>
        )}
        {!has ? (
          <div className="emptysheet">{t("noLyricsHere")}<br />{t("tapEditToPaste")}</div>
        ) : immersive ? (
          <div className="imm">
            {Array.from({ length: n }).map((_, i) => {
              const p = (pl[i] || "").trim(), e = (en[i] || "").trim();
              if (!p && !e) return <div key={i} className="immgap" />;
              const open = !!revealed[i];
              return (
                <button key={i} className={"immline" + (open ? " open" : "")}
                  onClick={() => setRevealed((r) => ({ ...r, [i]: !r[i] }))}>
                  {emoji && emoji[i] ? <span className="immemoji">{emoji[i]}</span> : null}
                  <span className="immpl">{esc(p) || " "}</span>
                  {open && e ? <span className="immen">{esc(e)}</span> : null}
                </button>
              );
            })}
            <p className="immhint">{t("immHint")}</p>
          </div>
        ) : (
          <>
            <div className="sheethead"><span>{song.language}</span><span>{targetLang || "English"}</span></div>
            <div className="grid">
              {Array.from({ length: n }).map((_, i) => {
                const p = (pl[i] || "").trim(), e = (en[i] || "").trim();
                if (!p && !e) return <React.Fragment key={i}><div className="cell gap pl" /><div className="cell gap en" /></React.Fragment>;
                return (
                  <React.Fragment key={i}>
                    <div className="cell pl">{emoji && emoji[i] ? <span className="cememoji">{emoji[i]} </span> : null}{esc(p) || " "}</div>
                    <div className="cell en">{esc(e) || " "}</div>
                  </React.Fragment>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}

// ---- Practice ---------------------------------------------------------------
const pracWords = (s) => norm(s).replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter(Boolean);
function grade(target, heard) {
  const t = pracWords(target); const h = new Set(pracWords(heard));
  let ok = 0; const marks = t.map((w) => { const hit = h.has(w); if (hit) ok++; return { w, ok: hit }; });
  return { pct: Math.round((100 * ok) / Math.max(1, t.length)), marks };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => { const s = String(r.result || ""); resolve(s.slice(s.indexOf(",") + 1)); };
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function Practice({ song, onBack }) {
  const tr = useT();
  const bcp = langOf(song.language).bcp;
  const lang2 = (bcp || "pl").slice(0, 2);
  const lines = React.useMemo(() => {
    const pl = (song.pl || "").split(SPLIT_RE);
    const en = (song.en || "").split(SPLIT_RE);
    return pl.map((s, i) => ({ pl: s.trim(), en: (en[i] || "").trim() })).filter((l) => l.pl);
  }, [song.id]);
  const [idx, setIdx] = useState(0);
  const [heard, setHeard] = useState("");
  const [score, setScore] = useState(null);
  const [listening, setListening] = useState(false);  // recording (whisper) or recognising (browser)
  const [ready, setReady] = useState(false);          // mic live → "Speak now"
  const [countdown, setCountdown] = useState(null);
  const [processing, setProcessing] = useState(false); // awaiting Whisper transcript
  const [recUrl, setRecUrl] = useState(null);
  const [recording, setRecording] = useState(false);  // browser-mode separate self-recording
  const [showEn, setShowEn] = useState(false);
  const [engine, setEngine] = useState(null);         // "whisper" | "browser" | "none" | null (checking)
  const recRef = useRef(null), mediaRef = useRef(null), streamRef = useRef(null), chunksRef = useRef([]);
  const cdRef = useRef(null), vadRef = useRef(null), capRef = useRef(null), lastTapRef = useRef(0);
  const Rec = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const line = lines[idx];

  // Pick the best available engine: Whisper when the server has a key, else the browser.
  useEffect(() => {
    let ok = true;
    fetch("/api/transcribe", { headers: apiHeaders() })
      .then((r) => r.json())
      .then((j) => { if (ok) setEngine(j && j.configured ? "whisper" : (Rec ? "browser" : "none")); })
      .catch(() => { if (ok) setEngine(Rec ? "browser" : "none"); });
    return () => { ok = false; };
  }, []);

  const stopAll = () => {
    try { clearInterval(cdRef.current); } catch {}
    try { clearInterval(vadRef.current); } catch {}
    try { clearTimeout(capRef.current); } catch {}
    try { recRef.current?.stop(); } catch {}
    try { if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop(); } catch {}
    try { streamRef.current?.getTracks().forEach((trk) => trk.stop()); } catch {}
  };

  useEffect(() => () => { stopAll(); try { window.speechSynthesis?.cancel(); } catch {} }, []);

  if (!line) return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>{tr("practice")}</h2><p>{song.title}</p></div>
      </div>
      <div className="prac"><p className="pracnote">{tr("noPracticeYet")}</p></div>
    </>
  );

  const speak = (rate = 0.75) => {
    try {
      const synth = window.speechSynthesis; synth.cancel();
      const u = new SpeechSynthesisUtterance(line.pl);
      u.lang = bcp; u.rate = rate;
      const v = synth.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith(lang2));
      if (v) u.voice = v;
      synth.speak(u);
    } catch {}
  };
  // Single tap = normal; a quick second tap re-plays at half speed.
  const onListen = () => {
    const now = Date.now();
    const dbl = now - lastTapRef.current < 350;
    lastTapRef.current = now;
    speak(dbl ? 0.45 : 0.75);
  };
  const clearRec = () => { if (recUrl) { try { URL.revokeObjectURL(recUrl); } catch {} setRecUrl(null); } };

  // ---- Whisper path: record the line, transcribe the clip, grade it; same clip plays back.
  const startWhisper = async () => {
    setHeard(""); setScore(null); clearRec(); setListening(true); setReady(false);
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setListening(false); return; }
    streamRef.current = stream; chunksRef.current = [];
    const mime = window.MediaRecorder?.isTypeSupported("audio/webm") ? "audio/webm"
      : window.MediaRecorder?.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
    let mr;
    try { mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); }
    catch { stream.getTracks().forEach((t) => t.stop()); setListening(false); return; }
    mediaRef.current = mr;
    const chunks = chunksRef.current;
    mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      try { clearInterval(vadRef.current); } catch {}
      try { clearTimeout(capRef.current); } catch {}
      stream.getTracks().forEach((t) => t.stop());
      setListening(false); setReady(false);
      const blob = new Blob(chunks, { type: mime || "audio/webm" });
      if (!blob.size) return;
      setRecUrl(URL.createObjectURL(blob));
      setProcessing(true);
      try {
        const b64 = await blobToBase64(blob);
        const r = await fetch("/api/transcribe", {
          method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
          body: JSON.stringify({ audio: b64, mime: mime || "audio/webm", language: lang2 }),
        });
        if (aiCapHit(r, tr)) return;
        const j = await r.json();
        const t = (j.text || "").trim();
        if (t) { setHeard(t); setScore(grade(line.pl, t)); }
      } catch {} finally { setProcessing(false); }
    };
    mr.start(); setReady(true);
    const safeStop = () => { try { if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop(); } catch {} };
    capRef.current = setTimeout(safeStop, 20000); // hard cap
    // Voice-activity detection: stop once the speaker has talked then fallen silent.
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        const ctx = new AC();
        const an = ctx.createAnalyser(); an.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.fftSize);
        let spoke = false, silence = 0, el = 0;
        vadRef.current = setInterval(() => {
          an.getByteTimeDomainData(buf);
          let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / buf.length); el += 100;
          if (rms > 0.025) { spoke = true; silence = 0; } else if (spoke) { silence += 100; }
          if (spoke && silence >= 1300 && el >= 600) { try { ctx.close(); } catch {} safeStop(); }
        }, 100);
      }
    } catch {}
  };

  // ---- Browser path: live Web Speech recognition (no recorder, so no mic clash).
  const startBrowser = () => {
    if (!Rec) return;
    setHeard(""); setScore(null); setListening(true); setReady(false);
    const rec = new Rec(); recRef.current = rec;
    rec.lang = bcp; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onstart = () => setReady(true);
    rec.onresult = (e) => { const t = e.results[0][0].transcript; setHeard(t); setScore(grade(line.pl, t)); };
    rec.onerror = () => { setReady(false); };
    rec.onend = () => { setListening(false); setReady(false); };
    try { rec.start(); } catch { setListening(false); setReady(false); }
  };

  // Browser-mode only: a separate recorder so the user can still hear themselves.
  const toggleRecord = async () => {
    if (recording) {
      try { if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop(); } catch {}
      setRecording(false);
      return;
    }
    if (listening || countdown !== null) return;
    clearRec();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream; chunksRef.current = [];
      const mr = new MediaRecorder(stream); mediaRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        try {
          const blob = new Blob(chunksRef.current, { type: mediaRef.current?.mimeType || "audio/webm" });
          if (blob.size) setRecUrl(URL.createObjectURL(blob));
        } catch {}
        try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
      };
      mr.start(); setRecording(true);
    } catch { setRecording(false); }
  };

  const beginListen = () => {
    if (listening || countdown !== null || recording || processing) return;
    setHeard(""); setScore(null);
    let n = 3;
    setCountdown(n);
    cdRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        try { clearInterval(cdRef.current); } catch {}
        setCountdown(null);
        if (engine === "whisper") startWhisper(); else startBrowser();
      } else setCountdown(n);
    }, 750);
  };

  const stopListen = () => {
    try { clearInterval(cdRef.current); } catch {}
    try { recRef.current?.stop(); } catch {}
    try { if (mediaRef.current && mediaRef.current.state !== "inactive") mediaRef.current.stop(); } catch {}
    setCountdown(null); setListening(false); setReady(false);
  };
  const playBack = () => { if (recUrl) { try { const a = new Audio(recUrl); a.play(); } catch {} } };
  const go = (d) => {
    stopAll(); setCountdown(null); setListening(false); setReady(false); setRecording(false); setProcessing(false);
    setHeard(""); setScore(null); setShowEn(false); clearRec();
    setIdx((i) => Math.min(lines.length - 1, Math.max(0, i + d)));
  };

  const canSpeak = engine === "whisper" || (engine === "browser" && Rec);

  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>{tr("practice")}</h2><p>{song.title} · {idx + 1}/{lines.length}</p></div>
      </div>
      <div className="prac">
        <div className="pracline">
          {score ? score.marks.map((m, i) => <span key={i} className={m.ok ? "wok" : "wno"}>{m.w}{" "}</span>) : line.pl}
        </div>
        {showEn && <div className="pracen">{line.en || "—"}</div>}
        <button className="pracen-toggle" onClick={() => setShowEn((v) => !v)}>{showEn ? tr("hideMeaning") : tr("showMeaning")}</button>
        {(countdown !== null || ready || processing) && (
          <div className={"praccue" + ((ready || processing) ? " live" : "")}>
            {countdown !== null ? countdown : (processing ? tr("checking") : tr("speakNow"))}
          </div>
        )}
        <div className="pracbtns">
          <button className="pracbtn" onClick={onListen}>{tr("listen")}</button>
          {canSpeak && (
            <button className={"pracbtn mic" + (listening ? " on" : "")} onClick={listening ? stopListen : beginListen} disabled={countdown !== null || processing || recording}>
              {countdown !== null ? tr("getReady") : (listening ? tr("listeningStop") : tr("speak"))}
            </button>
          )}
        </div>
        <p className="prachint">{tr("slowHint")}</p>
        {(recUrl || engine === "browser") && (
          <div className="pracbtns">
            {engine === "browser" && (
              <button className={"pracbtn" + (recording ? " on" : "")} onClick={toggleRecord} disabled={listening || countdown !== null || processing}>
                {recording ? tr("recStop") : tr("recSelf")}
              </button>
            )}
            {recUrl && <button className="pracbtn" onClick={playBack}>{tr("hearYourself")}</button>}
          </div>
        )}
        {heard && (
          <div className="pracfb">
            <div className="pracpct" data-good={!!(score && score.pct >= 70)}>{score ? score.pct : 0}% match</div>
            <div className="pracheard">You said: “{heard}”</div>
          </div>
        )}
        {engine === "none" && <p className="pracnote">Speaking feedback needs Chrome or an Android phone. You can still tap Listen and read along.</p>}
        <div className="pracnav">
          <button className="navbtn" onClick={() => go(-1)} disabled={idx === 0}>{tr("prev")}</button>
          <button className="navbtn" onClick={() => go(1)} disabled={idx === lines.length - 1}>{tr("next")}</button>
        </div>
      </div>
    </>
  );
}

// ---- Editor -----------------------------------------------------------------
function Editor({ song, provider, setProvider, hasOwnKey, onSaveKey, targetLang, onBack, onSave, onRemove, flash }) {
  const t = useT();
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist || "");
  const [album, setAlbum] = useState(song.album || "");
  const [titleEn, setTitleEn] = useState(song.titleEn || "");
  const [albumEn, setAlbumEn] = useState(song.albumEn || "");
  const [language, setLanguage] = useState(song.language || "Polish");
  const [pl, setPl] = useState(song.pl || "");
  const [en, setEn] = useState(song.en || "");
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchStage, setFetchStage] = useState("");
  const [trialOut, setTrialOut] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [tidyBusy, setTidyBusy] = useState(false);
  const [aiOk, setAiOk] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [extractBusy, setExtractBusy] = useState(false);
  const linkRef = useRef(null);
  // When auto-find comes up empty, point the user at the link field.
  useEffect(() => { if (showLink && linkRef.current) { try { linkRef.current.focus(); } catch {} } }, [showLink]);

  useEffect(() => {
    let ok = true;
    fetch("/api/tidy", { headers: apiHeaders() }).then((r) => r.json())
      .then((j) => { if (ok) setAiOk(!!(j && j.configured)); }).catch(() => {});
    return () => { ok = false; };
  }, []);

  // Clean the "copied from" footer and odd line-break chars out of a paste —
  // and if what's pasted is just a web link, extract the lyric from that page.
  const onPasteLyrics = (e) => {
    const cd = e.clipboardData; if (!cd) return;
    const raw = cd.getData("text"); if (!raw) return;
    const trimmed = raw.trim();
    if (aiOk && /^https?:\/\/\S+$/i.test(trimmed)) {
      e.preventDefault();
      flash(t("gotLink"));
      extractFromLink(trimmed);
      return;
    }
    e.preventDefault();
    const el = e.target;
    const clean = normLines(stripFooter(raw));
    const start = el.selectionStart ?? pl.length, end = el.selectionEnd ?? pl.length;
    const next = pl.slice(0, start) + clean + pl.slice(end);
    setPl(next);
    requestAnimationFrame(() => { try { el.selectionStart = el.selectionEnd = start + clean.length; } catch {} });
  };

  // Rebuild proper lyric lines when a site flattened them into one run of text.
  async function tidyLyrics() {
    if (tidyBusy || !pl.trim()) return;
    setTidyBusy(true);
    try {
      const r = await fetch("/api/tidy", {
        method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
        body: JSON.stringify({ text: pl, language }),
      });
      if (aiCapHit(r, t)) return;
      const j = await r.json();
      if (j && typeof j.text === "string" && j.text.trim()) setPl(normLines(j.text));
      else flash(t("tidyFailed"));
    } catch { flash(t("tidyFailed")); } finally { setTidyBusy(false); }
  }

  // Put fetched/extracted lyrics into the box — and, if you have your own key,
  // translate them straight away so the side-by-side appears without a second tap.
  const applyLyrics = (text, force) => {
    if (!force && pl && pl.trim()) return false;   // never clobber lyrics you typed
    const clean = normLines(text);
    setPl(clean);
    if (hasOwnKey && !en.trim()) autoTranslate(clean);
    return true;
  };

  // Fetch a lyrics-page link and let the AI pull out just the lyric.
  async function extractFromLink(urlArg) {
    const url = (typeof urlArg === "string" ? urlArg : linkUrl).trim();
    if (extractBusy || !url) return;
    setExtractBusy(true);
    try {
      const r = await fetch("/api/extract", {
        method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
        body: JSON.stringify({ url, language }),
      });
      if (aiCapHit(r, t)) return;
      const j = await r.json();
      if (j && typeof j.text === "string" && j.text.trim()) { applyLyrics(j.text, true); setShowLink(false); setLinkUrl(""); flash(t("tLyricsFound")); }
      else flash(j && j.error ? j.error : t("extractFailed"));
    } catch { flash(t("extractFailed")); } finally { setExtractBusy(false); }
  }

  // Try to pull the original lyric automatically (lyrics.ovh via /api/lyrics).
  // `auto` = called silently on open; otherwise it's the button, which reports.
  async function fetchLyrics(auto) {
    if (!title.trim() || !artist.trim()) { if (!auto) flash(t("tAddArtistFirst")); return; }
    setFetching(true);
    try {
      // 1. Fast exact lookup in the lyric DB.
      const r = await fetch(`/api/lyrics?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`, { headers: apiHeaders() });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.lyrics && j.lyrics.trim()) {
        applyLyrics(j.lyrics.trim());
        if (!auto) flash(t("tLyricsFound"));
        return;
      }
      if (auto) return; // the silent on-open attempt stops at the quick DB

      // 2. Search the web for a lyrics page, fetch it, and extract — no URL to copy.
      if (aiOk) {
        setFetchStage(t("searchingWeb"));
        const r2 = await fetch("/api/findlyrics", {
          method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
          body: JSON.stringify({ artist, title, language }),
        });
        if (aiCapHit(r2, t)) return;
        const j2 = await r2.json().catch(() => ({}));
        if (j2 && j2.text && j2.text.trim()) {
          applyLyrics(j2.text);
          flash(t("tLyricsFound"));
          return;
        }
        // 3. Still nothing → let the user paste a specific page link.
        setShowLink(true); flash(t("autoFellBack"));
      } else {
        flash(t("tLyricsNone"));
      }
    } catch (e) {
      if (!auto) { if (aiOk) { setShowLink(true); flash(t("autoFellBack")); } else flash("Lyric lookup failed: " + e.message); }
    } finally {
      setFetching(false); setFetchStage("");
    }
  }
  // On opening a song that has no lyrics yet, have a go automatically.
  useEffect(() => { if (!(song.pl || "").trim()) fetchLyrics(true); /* eslint-disable-next-line */ }, []);

  async function autoTranslate(srcArg) {
    const src = typeof srcArg === "string" ? srcArg : pl;
    const lyrics = src.split(SPLIT_RE);
    if (!src.trim()) { flash(t("tPasteFirst")); return; }
    setBusy(true);
    try {
      // Translate the title + album in the SAME call as the lyrics (one request,
      // no extra quota). They ride at the end; blanks come back blank.
      const lines = [...lyrics, title.trim(), album.trim()];
      const r = await fetch("/api/translate", {
        method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
        body: JSON.stringify({ lines, source: langOf(language).code, target: langOf(targetLang || "English").code, provider }),
      });
      if (r.status === 402) { setTrialOut(true); setBusy(false); return; } // free trial used up
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Translation failed");
      const tr = (j.translations || []).slice();
      const albumTr = tr.pop(); const titleTr = tr.pop(); // last two are album, title
      setEn(tr.join("\n"));
      setTitleEn(titleTr || "");
      setAlbumEn(albumTr || "");
      if (j.usedOwnKey) flash(t("tTranslated"));
      else if (typeof j.trialRemaining === "number") flash(j.trialRemaining > 0
        ? t("tTrLeft", { n: j.trialRemaining })
        : t("tTrLast"));
      else flash(t("tTranslated"));
    } catch (e) {
      flash("Couldn't translate: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveKeyAndRetry() {
    if (!keyInput.trim() || savingKey) return;
    setSavingKey(true);
    const ok = await onSaveKey(keyInput.trim());
    setSavingKey(false);
    if (ok) { setTrialOut(false); setKeyInput(""); autoTranslate(); }
  }

  const findUrl = "https://www.google.com/search?q=" + encodeURIComponent(`${artist} ${title || ""} ${language === "Polish" ? "tekst" : "lyrics"}`.trim());

  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>{t("edit")}</h2><p>{song.title}</p></div>
      </div>
      <div className="editor">
        <div className="meta3">
          <div><label>{t("title")}</label><input value={title} onChange={(e) => { setTitle(e.target.value); setTitleEn(""); }} /></div>
          <div><label>{t("artist")}</label><input value={artist} onChange={(e) => setArtist(e.target.value)} /></div>
          <div><label>{t("album")} <span className="opt">{t("optional")}</span></label><input value={album} onChange={(e) => { setAlbum(e.target.value); setAlbumEn(""); }} /></div>
          <div><label>{t("language")}</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGS.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
            </select>
          </div>
        </div>
        <div className="cols">
          <div>
            <label>{language} <span className="opt">{t("pasteWhole")}</span></label>
            <textarea value={pl} onChange={(e) => setPl(normLines(e.target.value))} onPaste={onPasteLyrics} placeholder={fetching ? t("fetching") : t(aiOk ? "lyricBoxPh" : "lyricBoxPhPlain")} />
            {aiOk && pl.trim() && (
              <div className="lyr-tidy">
                <span>{t("lyrTidyHint")}</span>
                <button type="button" className="lyr-btn" onClick={tidyLyrics} disabled={tidyBusy}>{tidyBusy ? t("tidyBusy") : t("lyrTidyBtn")}</button>
              </div>
            )}
            <div className="lyr-src">
              <div className="lyr-opt">
                <button type="button" className={"lyr-find" + (pl.trim() ? " quiet" : "")} onClick={() => fetchLyrics(false)} disabled={fetching}>
                  {fetching ? (fetchStage || t("fetching")) : t("lyrFind")}
                </button>
                <p className="lyr-note">{t("lyrFindHint")}</p>
              </div>
              {aiOk && (
                <div className={"lyr-opt lyr-link" + (showLink ? " hot" : "")}>
                  <label htmlFor="lyr-link-in">{t("lyrLinkLabel")}</label>
                  <div className="linkrow">
                    <input id="lyr-link-in" ref={linkRef} type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                      value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder={t("lyrLinkPh")}
                      onKeyDown={(e) => e.key === "Enter" && extractFromLink()} />
                    <button type="button" className="lyr-btn" onClick={extractFromLink} disabled={extractBusy || !linkUrl.trim()}>
                      {extractBusy ? t("extracting") : t("lyrLinkBtn")}
                    </button>
                  </div>
                  <p className="lyr-note">{t("lyrLinkHint")}</p>
                </div>
              )}
              <div className="lyr-opt lyr-web">
                <p className="lyr-note">
                  <a href={findUrl} target="_blank" rel="noreferrer">{t("lyrWebBtn")}<span aria-hidden="true"> ↗</span></a>
                  {" "}{t(aiOk ? "lyrWebHint" : "lyrWebHintPlain")}
                </p>
              </div>
            </div>
          </div>
          <div>
            <label>{targetLang || "English"} <span className="opt">{t("autoOrType")}</span></label>
            <textarea className="en" value={en} onChange={(e) => setEn(normLines(e.target.value))} placeholder={pl.trim() && !en.trim() ? t("translatePrompt") : t("autoOrType")} />
            <div className="trrow">
              <button className={"tr" + (pl.trim() && !en.trim() && !busy ? " cta" : "")} onClick={autoTranslate} disabled={busy}>{busy ? t("translating") : t("autoTranslate")}</button>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Translation provider">
                <option value="deepl">DeepL</option>
                <option value="google">Google</option>
              </select>
            </div>
          </div>
        </div>
        {trialOut && !hasOwnKey && (
          <div className="upsell">
            <h4>{t("trialTitle")}</h4>
            <p>{t("trialBody")}</p>
            <a className="findbtn" href="https://www.deepl.com/pro-api" target="_blank" rel="noreferrer">{t("getKey")}</a>
            <div className="upsellrow">
              <div className="pwfield" style={{ flex: 1 }}>
                <input type={showKeyInput ? "text" : "password"} value={keyInput} placeholder={t("pasteKey")} onChange={(e) => setKeyInput(e.target.value)} />
                <button type="button" className="pweye" onClick={() => setShowKeyInput((v) => !v)} aria-label={showKeyInput ? t("hide") : t("show")}>{showKeyInput ? t("hide") : t("show")}</button>
              </div>
              <button className="tr" onClick={saveKeyAndRetry} disabled={savingKey || !keyInput.trim()}>{savingKey ? "…" : t("saveTranslate")}</button>
            </div>
          </div>
        )}
        <p className="hint2">{t("translateHint")}</p>
        <div className="actions">
          <button className="save" onClick={() => onSave({ title: title.trim() || song.title, artist: artist.trim(), album: album.trim(), titleEn: titleEn.trim(), albumEn: albumEn.trim(), language, pl, en })}>{t("save")}</button>
          <button className="cancel" onClick={onBack}>{t("cancel")}</button>
        </div>
        <button className="danger" onClick={onRemove}>{t("removeSong")}</button>
      </div>
    </>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Inter:wght@400;500;600&display=swap');
.kl-root{ color-scheme:dark;
  --night:#1a2130; --night-2:#232c3f; --night-3:#2b3650; --line:rgba(255,255,255,.08);
  --paper:#f5f0e6; --ink:#23262d; --ink-soft:#73707f; --rule:#ddd2bd;
  --mist:#b3bccb; --mist-dim:#7c8698; --rose:#d67c70;
  --serif:'Newsreader',Georgia,serif; --display:'Fraunces',Georgia,serif; --ui:'Inter',system-ui,sans-serif;
  min-height:100vh; background:radial-gradient(130% 80% at 50% -10%, #26304a 0%, var(--night) 55%) fixed;
  font-family:var(--ui); color:var(--mist); -webkit-font-smoothing:antialiased; display:flex; justify-content:center; }
.kl-root *{ box-sizing:border-box; }
.app{ width:100%; max-width:680px; min-height:100vh; display:flex; flex-direction:column; position:relative; }
.splash{ margin:auto; font-family:var(--display); font-weight:900; font-size:26px; color:#f3ede1; opacity:.8; }
.top{ padding:22px 20px 16px; border-bottom:1px solid var(--line); }
.toprow{ display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; }
.topbtns{ display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end; }
.signout{ background:var(--night-2); border:1px solid var(--line); color:var(--mist-dim); border-radius:9px; padding:6px 12px; font-size:12px; font-family:var(--ui); cursor:pointer; }
.signout.accent{ color:var(--rose); border-color:color-mix(in srgb, var(--rose) 45%, var(--line)); }
.fbarea{ width:100%; box-sizing:border-box; background:var(--night-3); border:1px solid var(--line); color:var(--mist); border-radius:10px; padding:12px 14px; font-family:var(--ui); font-size:14px; line-height:1.5; resize:vertical; margin-top:12px; }
.fbarea:focus{ outline:none; border-color:var(--rose); }
.setcard{ background:var(--night-2); border:1px solid var(--line); border-radius:14px; padding:18px; }
.setcard h3{ margin:0 0 10px; font-family:var(--display); font-weight:600; font-size:18px; color:#f0ebe0; }
.setstate{ font-size:13px; color:var(--mist-dim); line-height:1.5; margin:0 0 14px; } .setstate.ok{ color:#8fd49a; }
.setbtns{ display:flex; gap:10px; margin-top:12px; }
.upsell{ background:var(--night-2); border:1px solid var(--rose); border-radius:14px; padding:16px; margin-top:16px; }
.upsell h4{ margin:0 0 6px; font-family:var(--display); font-weight:600; font-size:16px; color:#f0ebe0; }
.upsell p{ margin:0 0 12px; font-size:13px; color:var(--mist-dim); line-height:1.5; }
.upsellrow{ display:flex; gap:8px; margin-top:12px; } .upsellrow input{ flex:1; }
.eyebrow{ font-size:11px; letter-spacing:.2em; text-transform:uppercase; color:var(--rose); font-weight:600; }
.top h1{ font-family:var(--display); font-weight:900; font-size:30px; letter-spacing:-.02em; color:#f3ede1; margin:4px 0 0; line-height:1.02; }
.top p{ margin:7px 0 0; font-size:13px; color:var(--mist-dim); }
.body{ flex:1; padding:6px 16px 60px; }
.emptylib{ text-align:center; color:var(--mist-dim); padding:48px 20px; font-size:14px; line-height:1.6; } .emptylib b{ color:#f0ebe0; }
.emptyhero{ text-align:center; padding:42px 20px 24px; }
.emptyhero .emptyicon{ font-family:var(--display); font-size:44px; color:var(--rose); line-height:1; }
.emptyhero h3{ font-family:var(--display); font-size:22px; margin:14px 0 6px; color:#f3ede1; }
.emptyhero p{ color:var(--mist-dim); font-size:14px; line-height:1.6; margin:0 auto 20px; max-width:320px; }
.add.big{ font-size:16px; padding:15px; }
.emptyhelp{ display:block; margin:14px auto 0; background:none; border:0; color:var(--rose); font-size:13px; cursor:pointer; }

/* Welcome tour */
.tourwrap{ position:fixed; inset:0; z-index:50; background:rgba(10,14,22,.72); backdrop-filter:blur(3px); display:grid; place-items:center;
  padding:max(20px,env(safe-area-inset-top)) 20px max(20px,env(safe-area-inset-bottom)); }
.tourcard{ position:relative; width:100%; max-width:380px; background:var(--night); border:1px solid var(--line); border-radius:20px; padding:30px 24px 22px; text-align:center; }
.tourskip{ position:absolute; top:12px; right:14px; background:none; border:0; color:var(--mist-dim); font-size:13px; cursor:pointer; }
.touricon{ font-size:46px; line-height:1; }
.tourcard h2{ font-family:var(--display); font-size:23px; margin:14px 0 8px; color:#f3ede1; }
.tourcard p{ color:var(--mist); font-size:14.5px; line-height:1.6; margin:0 auto 18px; }
.tourdots{ display:flex; gap:7px; justify-content:center; margin:4px 0 18px; }
.tourdots span{ width:7px; height:7px; border-radius:50%; background:var(--line); }
.tourdots span.on{ background:var(--rose); }
.tournav{ display:flex; gap:10px; }
.tournav .add{ flex:1; }
.tournav .pracbtn{ flex:none; }
.albsect{ font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--mist-dim); padding:20px 4px 10px; display:flex; align-items:center; gap:10px; }
.albsect::after{ content:""; flex:1; height:1px; background:var(--line); }
.artsect{ font-family:var(--display); font-weight:600; font-size:15px; color:#e4d9c6; padding:12px 4px 8px; }
.albumsect{ font-family:var(--ui); font-weight:500; font-style:italic; font-size:12.5px; color:var(--mist-dim); padding:6px 4px 4px 14px; }
.songs{ display:flex; flex-direction:column; gap:8px; }
.song{ width:100%; text-align:left; cursor:pointer; background:var(--night-2); border:1px solid var(--line); border-radius:14px; padding:14px 16px; display:flex; align-items:center; gap:14px; color:inherit; font-family:inherit; transition:border-color .16s, transform .1s; }
.song:hover{ border-color:var(--night-3); } .song:active{ transform:scale(.995); }

/* Collapsible library: artist → album → songs */
.artgroup{ margin-bottom:8px; }
.artbtn, .albbtn{ width:100%; text-align:left; cursor:pointer; background:var(--night-2); border:1px solid var(--line); border-radius:14px; padding:13px 15px; display:flex; align-items:center; gap:11px; color:inherit; font-family:inherit; font-size:15px; transition:border-color .16s; }
.artbtn:hover, .albbtn:hover{ border-color:var(--night-3); }
.artbtn .artname{ flex:1; min-width:0; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.albbtn .artname{ flex:1; min-width:0; font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.artbtn .count, .albbtn .count{ flex:none; font-size:12px; color:var(--mist-dim); background:var(--night); border:1px solid var(--line); border-radius:999px; min-width:22px; text-align:center; padding:1px 7px; }
.artbtn .chev, .albbtn .chev{ flex:none; color:var(--mist-dim); font-size:12px; transition:transform .16s; }
.artbtn.open .chev, .albbtn.open .chev{ transform:rotate(90deg); }
.artbtn{ margin-bottom:8px; }
.artbtn.drill .chev.go{ transform:none; font-size:18px; }
.artback{ display:inline-flex; align-items:center; gap:6px; background:none; border:0; color:var(--rose); font-size:14px; cursor:pointer; padding:4px 2px; margin:0 0 10px; }
.artpagetitle{ font-size:22px; font-weight:600; margin:2px 0 14px; }
.artbody{ display:flex; flex-direction:column; gap:8px; padding-left:12px; border-left:2px solid var(--line); margin:7px 0 4px 10px; }
.albgroup{ display:flex; flex-direction:column; gap:8px; margin-bottom:8px; }
.albgroup .songs{ padding-left:10px; }
.albbtn .artname.noalbum{ font-style:italic; color:var(--mist-dim); }

/* Library lyric/word search */
.libsearch{ position:relative; margin:0 0 14px; }
.libsearch input{ width:100%; background:var(--night-2); border:1px solid var(--line); border-radius:12px; padding:12px 38px 12px 14px; color:var(--mist); font-family:var(--ui); font-size:14px; }
.libsearch input:focus{ outline:none; border-color:var(--rose); }
.libsearchx{ position:absolute; right:8px; top:50%; transform:translateY(-50%); background:none; border:0; color:var(--mist-dim); font-size:15px; cursor:pointer; padding:6px; line-height:1; }
.song.lyrichit{ margin-bottom:8px; }
.hitsub{ color:var(--mist-dim); font-size:12.5px; margin:2px 0 0; }
.hitsnip{ color:var(--mist); font-size:13px; margin:5px 0 0; font-style:italic; opacity:.9; overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }

/* Song row with inline delete */
.songrow{ display:flex; align-items:stretch; gap:8px; }
.songrow .song{ flex:1; min-width:0; }
.songdel{ flex:none; display:grid; place-items:center; min-width:46px; padding:0 12px; background:var(--night-2); border:1px solid var(--line); border-radius:14px; color:var(--mist-dim); font-size:15px; cursor:pointer; font-family:inherit; transition:border-color .16s, color .16s; }
.songdel:hover{ border-color:#c6616b; color:#e59aa0; }
.songdelask{ display:flex; gap:6px; flex:none; }
.songdel.yes{ min-width:0; padding:0 13px; background:#4e2730; border-color:#7a3a44; color:#ffd7dd; font-size:12.5px; font-weight:600; }
.songdel.no{ min-width:0; padding:0 13px; font-size:12.5px; font-weight:600; }
.num{ font-family:var(--display); font-weight:700; font-size:14px; color:var(--mist-dim); width:22px; flex:none; text-align:right; font-variant-numeric:tabular-nums; }
.song .meta{ flex:1; min-width:0; }
.song .meta h3{ margin:0; font-family:var(--display); font-weight:600; font-size:17px; color:#f0ebe0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.song .meta p{ margin:2px 0 0; font-size:12px; color:var(--mist-dim); }
.dot{ width:9px; height:9px; border-radius:50%; flex:none; } .dot.full{ background:var(--rose); } .dot.empty{ background:none; border:1.5px solid var(--night-3); }
.addrow{ margin-top:14px; } .add{ width:100%; background:none; border:1.5px dashed var(--night-3); color:var(--rose); border-radius:14px; padding:13px; font-family:var(--ui); font-size:14px; cursor:pointer; } .add:hover{ border-color:var(--rose); }
.rbar{ display:flex; align-items:center; gap:10px; padding:16px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--night); z-index:3; }
.icbtn{ background:var(--night-2); border:1px solid var(--line); color:var(--mist); border-radius:10px; height:38px; min-width:38px; padding:0 12px; cursor:pointer; font-size:14px; font-family:var(--ui); line-height:1; }
.icbtn.accent{ background:var(--rose); border-color:var(--rose); color:#20140f; font-weight:600; }
.rbar .ttl{ flex:1; min-width:0; } .rbar .ttl h2{ margin:0; font-family:var(--display); font-weight:900; font-size:19px; color:#f3ede1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .rbar .ttl p{ margin:2px 0 0; font-size:12px; color:var(--mist-dim); }
.rbar .ttl .ttltrans{ color:var(--mist); font-style:italic; font-size:12.5px; margin:1px 0 0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.rhead2{ position:sticky; top:0; z-index:4; background:var(--night); box-shadow:0 12px 20px -14px rgba(0,0,0,.6); }
.playerbox{ padding:12px 16px 12px; }
.plcontrols{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:9px; }
.ascroll{ display:flex; align-items:center; gap:6px; }
.asstep{ width:28px; height:28px; flex:none; background:var(--night-2); border:1px solid var(--line); color:var(--mist); border-radius:7px; font-size:16px; line-height:1; cursor:pointer; }
.autoscroll{ background:var(--night-2); border:1px solid var(--line); color:var(--mist); border-radius:8px; padding:6px 13px; font-size:12px; font-family:var(--ui); font-weight:500; cursor:pointer; white-space:nowrap; }
.autoscroll.on{ background:var(--rose); border-color:var(--rose); color:#20140f; }
.srctoggle{ display:flex; gap:6px; }
.srctoggle button{ background:var(--night-2); border:1px solid var(--line); color:var(--mist); border-radius:8px; padding:6px 13px; font-size:12px; font-family:var(--ui); font-weight:500; cursor:pointer; }
.srctoggle button.on{ background:var(--rose); border-color:var(--rose); color:#20140f; }
.yt{ display:block; width:100%; aspect-ratio:16/9; max-height:40vh; border:0; border-radius:12px; background:#000; }
.spotify{ display:block; width:100%; border:0; border-radius:12px; }
.sheet{ background:var(--paper); margin:16px; border-radius:16px; padding:8px 4px 20px; box-shadow:0 18px 50px rgba(0,0,0,.35); }
.sheethead{ display:grid; grid-template-columns:1fr 1fr; padding:12px 8px 10px; }
.sheethead span{ font-size:10.5px; letter-spacing:.16em; text-transform:uppercase; color:#a99a82; font-weight:600; padding:0 14px; } .sheethead span+span{ border-left:1px solid var(--rule); }
.grid{ display:grid; grid-template-columns:1fr 1fr; }
.cell{ min-width:0; padding:5px 14px; } .cell.pl{ font-family:var(--serif); font-size:17px; line-height:1.5; color:var(--ink); }
.cell.en{ font-family:var(--ui); font-size:14px; line-height:1.62; color:var(--ink-soft); border-left:1px solid var(--rule); }
.cell.gap{ height:12px; padding:0; } .cell.gap.en{ border-left:1px solid var(--rule); }
.emptysheet{ text-align:center; color:#8d8171; padding:34px 20px; font-size:13.5px; line-height:1.6; } .emptysheet b{ color:var(--ink); }
.cememoji{ font-size:15px; }
/* sheet toolbar (immersive / illustrate) */
.sheettools{ display:flex; gap:8px; padding:10px 14px 4px; flex-wrap:wrap; }
.stool{ background:transparent; border:1px solid var(--rule); border-radius:999px; padding:6px 13px; font-family:var(--ui); font-size:12.5px; font-weight:600; color:#8d8171; cursor:pointer; }
.stool.on{ background:var(--ink); border-color:var(--ink); color:var(--paper); }
.stool:disabled{ opacity:.55; cursor:default; }
/* immersive mode */
.imm{ padding:6px 4px 4px; }
.immline{ display:block; width:100%; text-align:left; background:transparent; border:0; border-bottom:1px solid var(--rule); padding:11px 14px; cursor:pointer; }
.immline:last-of-type{ border-bottom:0; }
.immline .immemoji{ font-size:19px; margin-right:10px; vertical-align:middle; }
.immline .immpl{ font-family:var(--serif); font-size:18px; line-height:1.5; color:var(--ink); }
.immline .immen{ display:block; font-family:var(--ui); font-size:13.5px; line-height:1.55; color:var(--ink-soft); margin-top:5px; }
.immline.open{ background:rgba(0,0,0,.03); }
.immgap{ height:12px; }
.immhint{ text-align:center; color:#8d8171; font-size:12px; padding:14px 20px 4px; line-height:1.5; }
.editor{ padding:16px; }
.editor .cols{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.editor label{ display:block; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--mist-dim); margin:0 0 7px; }
.editor .opt{ text-transform:none; letter-spacing:0; font-weight:400; color:var(--mist-dim); margin-left:6px; }
.editor textarea{ width:100%; min-height:300px; background:var(--night-2); border:1px solid var(--line); border-radius:12px; padding:12px 13px; color:#eef1f6; font-size:14px; line-height:1.55; outline:0; resize:vertical; font-family:var(--serif); }
.editor textarea.en{ font-family:var(--ui); } .editor textarea:focus{ border-color:var(--rose); }
.linkrow{ display:flex; flex-wrap:wrap; gap:8px; }
.linkrow input{ flex:1 1 150px; min-width:0; background:var(--night-2); border:1px solid var(--line); border-radius:11px; padding:10px 12px; color:#eef1f6; font-family:var(--ui); font-size:13.5px; outline:0; }
.linkrow input:focus{ border-color:var(--rose); }
.editor .findbtn{ background:var(--rose); color:#20140f; border:0; border-radius:10px; padding:10px 16px; font-family:var(--ui); font-size:13px; font-weight:600; cursor:pointer; text-decoration:none; display:inline-block; }
.lyr-src{ margin-top:10px; }
.lyr-opt + .lyr-opt{ margin-top:14px; padding-top:14px; border-top:1px solid var(--line); }
.editor .lyr-find{ display:block; width:100%; background:var(--rose); color:#20140f; border:1px solid var(--rose); border-radius:12px; padding:13px 16px; font-family:var(--ui); font-size:15px; font-weight:600; cursor:pointer; }
.editor .lyr-find.quiet{ background:none; color:var(--rose); }
.editor .lyr-find:disabled{ opacity:.6; cursor:default; }
.editor .lyr-btn{ flex:none; background:var(--night-3); border:1px solid var(--line); color:#eef1f6; border-radius:10px; padding:10px 13px; font-family:var(--ui); font-size:13px; font-weight:500; cursor:pointer; white-space:nowrap; }
.editor .lyr-btn:disabled{ opacity:.5; cursor:default; }
.editor .lyr-note{ font-size:12px; color:var(--mist-dim); margin:7px 2px 0; line-height:1.5; }
.editor .lyr-link label{ text-transform:none; letter-spacing:0; font-size:13px; font-weight:500; color:var(--mist); }
.lyr-link.hot .linkrow input{ border-color:var(--rose); }
.editor .lyr-web .lyr-note{ margin-top:0; }
.editor .lyr-web a{ color:var(--mist); font-weight:600; text-decoration:underline; text-underline-offset:3px; white-space:nowrap; }
.lyr-tidy{ display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:8px; font-size:12px; line-height:1.4; color:var(--mist-dim); }
.trrow{ display:flex; gap:8px; margin-top:8px; }
.trrow .tr{ flex:1; background:var(--night-3); border:1px solid var(--line); color:#eef1f6; border-radius:10px; padding:10px; font-family:var(--ui); font-size:13px; font-weight:500; cursor:pointer; }
.trrow .tr:disabled{ opacity:.55; cursor:default; }
.trrow .tr.cta{ background:var(--rose); border-color:var(--rose); color:#20140f; font-weight:700; animation:trpulse 1.8s ease-in-out infinite; }
@keyframes trpulse{ 0%,100%{ box-shadow:0 0 0 0 rgba(214,124,112,.45); } 50%{ box-shadow:0 0 0 6px rgba(214,124,112,0); } }
@media (prefers-reduced-motion: reduce){ .trrow .tr.cta{ animation:none; } }
.trrow select{ background:var(--night-2); border:1px solid var(--line); color:var(--mist); border-radius:10px; padding:0 10px; font-family:var(--ui); font-size:13px; outline:0; }
.editor .meta3{ display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px; }
.addform{ display:flex; flex-direction:column; gap:14px; margin-bottom:6px; }
.addlang{ margin-bottom:16px; }
.searchlabel{ display:block; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--mist-dim); margin:0 0 7px; }
.searchrow{ display:flex; gap:8px; }
.searchrow input{ flex:1; }
.searchbtn{ background:var(--rose); color:#20140f; border:0; border-radius:11px; padding:0 18px; font-family:var(--ui); font-size:14px; font-weight:600; cursor:pointer; } .searchbtn:disabled{ opacity:.5; cursor:default; }
.searchtip{ font-size:11.5px; color:var(--mist-dim); margin:8px 2px 0; line-height:1.5; }
.micbtn{ flex:none; width:44px; background:var(--night-2); border:1px solid var(--line); border-radius:11px; font-size:16px; cursor:pointer; color:var(--mist); }
.micbtn.on{ background:var(--rose); border-color:var(--rose); color:#20140f; }
.aibtn{ display:block; width:100%; margin-top:12px; background:var(--night-2); border:1px solid var(--line); color:var(--mist); border-radius:12px; padding:11px; font-family:var(--ui); font-size:13.5px; font-weight:600; cursor:pointer; }
.aibtn:hover{ border-color:var(--rose); color:#f0ebe0; } .aibtn:disabled{ opacity:.6; cursor:default; }
.ailabel{ font-size:11.5px; color:var(--mist-dim); margin:4px 2px 10px; }
.results{ display:flex; flex-direction:column; gap:8px; margin-top:14px; }
.sresult{ width:100%; text-align:left; cursor:pointer; background:var(--night-2); border:1px solid var(--line); border-radius:12px; padding:12px 14px; display:flex; align-items:center; gap:12px; color:inherit; font-family:inherit; }
.sresult:hover{ border-color:var(--rose); } .sresult:disabled{ opacity:.6; }
.sresult .meta{ flex:1; min-width:0; } .sresult .meta h3{ margin:0; font-family:var(--display); font-weight:600; font-size:16px; color:#f0ebe0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .sresult .meta p{ margin:2px 0 0; font-size:12px; color:var(--mist-dim); }
.pickarrow{ flex:none; color:var(--rose); font-size:18px; font-weight:600; }
.noresults{ color:var(--mist-dim); font-size:13px; text-align:center; padding:20px; }
.manuallink{ display:block; margin:18px auto 0; background:none; border:0; color:var(--rose); font-size:13px; cursor:pointer; }
.webfindwrap{ margin-top:16px; text-align:center; }
.webfind{ display:inline-block; background:var(--rose); color:#20140f; border:0; border-radius:10px; padding:9px 16px; font-family:var(--ui); font-size:13px; font-weight:600; cursor:pointer; text-decoration:none; }
.webfindhint{ font-size:11.5px; color:var(--mist-dim); margin:8px 2px 0; line-height:1.5; }
.editor input, .editor select{ width:100%; background:var(--night-2); border:1px solid var(--line); border-radius:11px; padding:11px 13px; color:#eef1f6; font-size:14px; outline:0; font-family:var(--ui); } .editor input:focus, .editor select:focus{ border-color:var(--rose); }
.editor .hint2{ font-size:12px; color:var(--mist-dim); margin:12px 2px 0; line-height:1.5; }
.editor .actions{ display:flex; gap:10px; margin-top:16px; }
.editor .save{ flex:1; background:var(--rose); color:#20140f; border:0; border-radius:12px; padding:13px; font-weight:600; font-size:15px; font-family:var(--ui); cursor:pointer; } .editor .save:disabled{ opacity:.55; }
.editor .cancel{ background:none; border:1px solid var(--line); color:var(--mist-dim); border-radius:12px; padding:13px 18px; font-size:14px; font-family:var(--ui); cursor:pointer; }
.editor .danger{ background:none; border:0; color:var(--mist-dim); font-size:12.5px; cursor:pointer; margin-top:18px; text-decoration:underline; }
.prac{ padding:22px 18px 44px; max-width:520px; margin:0 auto; }
.pracline{ font-family:var(--serif); font-size:25px; line-height:1.45; color:#f3ede1; text-align:center; margin:22px 0 2px; text-wrap:balance; }
.pracline .wok{ color:#8fd49a; } .pracline .wno{ color:#e8938a; }
.pracen{ text-align:center; color:var(--mist-dim); font-size:15px; margin:10px 0 0; }
.pracen-toggle{ display:block; margin:10px auto 0; background:none; border:0; color:var(--rose); font-size:12.5px; cursor:pointer; }
.praccue{ text-align:center; font-family:var(--display); font-weight:900; font-size:52px; line-height:1; color:var(--mist-dim); margin:18px 0 2px; }
.praccue.live{ font-size:22px; color:var(--rose); letter-spacing:.02em; animation:cuepulse 1s ease-in-out infinite; }
@keyframes cuepulse{ 0%,100%{ opacity:1; } 50%{ opacity:.55; } }
@media (prefers-reduced-motion: reduce){ .praccue.live{ animation:none; } }
.pracbtn:disabled{ opacity:.45; cursor:default; }
.pracbtns{ display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin:28px 0 6px; }
.pracbtn{ background:var(--night-2); border:1px solid var(--line); color:#eef1f6; border-radius:12px; padding:13px 24px; font-size:15px; font-family:var(--ui); font-weight:500; cursor:pointer; }
.pracbtn.mic.on{ background:var(--rose); border-color:var(--rose); color:#20140f; }
.pracbtn.on{ background:var(--rose); border-color:var(--rose); color:#20140f; }
.prachint{ font-size:11.5px; color:var(--mist-dim); margin:8px 0 0; text-align:center; }
.pracfb{ text-align:center; margin:20px 0 4px; }
.pracpct{ font-family:var(--display); font-weight:900; font-size:32px; color:#e8938a; }
.pracpct[data-good="true"]{ color:#8fd49a; }
.pracheard{ color:var(--mist-dim); font-size:14px; margin-top:8px; font-style:italic; }
.pracnote{ text-align:center; color:var(--mist-dim); font-size:12.5px; margin:18px auto 0; max-width:300px; line-height:1.55; }
.pracnav{ display:flex; gap:10px; justify-content:space-between; margin-top:34px; }
.navbtn{ flex:1; background:var(--night-2); border:1px solid var(--line); color:var(--mist); border-radius:11px; padding:12px; font-size:14px; font-family:var(--ui); cursor:pointer; }
.navbtn:disabled{ opacity:.4; cursor:default; }
.lock{ min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
.lockcard{ width:100%; max-width:340px; text-align:center; }
.lockcard h1{ font-family:var(--display); font-weight:900; font-size:34px; letter-spacing:-.02em; color:#f3ede1; margin:6px 0 0; }
.lockcard .eyebrow{ font-size:11px; letter-spacing:.2em; text-transform:uppercase; color:var(--rose); font-weight:600; }
.lockcard p{ color:var(--mist-dim); font-size:13.5px; margin:10px 0 18px; }
.lockcard input{ width:100%; background:var(--night-2); border:1px solid var(--line); border-radius:12px; padding:13px 15px; color:#eef1f6; font-size:16px; outline:0; font-family:var(--ui); text-align:center; }
.lockcard input:focus{ border-color:var(--rose); }
.lockcard .pwwrap{ position:relative; margin-top:10px; }
.lockcard .pwwrap input{ text-align:left; padding-right:70px; margin-top:0; }
.lockcard .pweye{ position:absolute; right:6px; top:50%; transform:translateY(-50%); width:auto; margin:0; background:var(--night-3); border:1px solid var(--line); color:var(--mist); border-radius:8px; padding:7px 11px; font-size:12px; font-weight:500; cursor:pointer; }
.pwfield{ position:relative; }
.pwfield input{ padding-right:70px; }
.pwfield .pweye{ position:absolute; right:6px; top:50%; transform:translateY(-50%); background:var(--night-3); border:1px solid var(--line); color:var(--mist); border-radius:8px; padding:7px 11px; font-size:12px; font-weight:500; cursor:pointer; }
.lockcard .welcomesel{ width:100%; background:var(--night-2); border:1px solid var(--line); border-radius:12px; padding:13px 15px; color:#eef1f6; font-size:16px; outline:0; font-family:var(--ui); } .lockcard .welcomesel:focus{ border-color:var(--rose); }
.lockcard .lockerr{ color:#e8938a; font-size:12.5px; margin-top:10px; }
.lockcard .locknote{ color:#8fd49a; font-size:12.5px; margin-top:10px; line-height:1.5; }
.lockcard button{ margin-top:14px; width:100%; background:var(--rose); color:#20140f; border:0; border-radius:12px; padding:13px; font-weight:600; font-size:15px; font-family:var(--ui); cursor:pointer; }
.lockcard button:disabled{ opacity:.5; cursor:default; }
.lockcard .linkbtn{ background:none; border:0; color:var(--mist-dim); font-size:12.5px; margin-top:12px; padding:0; text-decoration:underline; width:auto; }
.kl-toast{ position:fixed; left:50%; bottom:26px; transform:translateX(-50%) translateY(10px); opacity:0; background:#2c2030; color:#f3e7e4; border:1px solid var(--rose); border-radius:11px; padding:10px 15px; font-size:12.5px; pointer-events:none; transition:opacity .2s, transform .2s; z-index:9; max-width:84%; text-align:center; }
.kl-toast.show{ opacity:1; transform:translateX(-50%) translateY(0); }
@media(max-width:520px){ .cell.pl{ font-size:15px; } .cell.en{ font-size:12.5px; } .editor .cols{ grid-template-columns:1fr; } .editor .meta3{ grid-template-columns:1fr; } .top h1{ font-size:26px; } }
.kl-root :focus-visible{ outline:2px solid var(--rose); outline-offset:2px; }
@media (prefers-reduced-motion: reduce){ .kl-root *{ transition:none !important; } }
`;
