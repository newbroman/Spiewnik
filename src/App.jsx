import React, { useEffect, useRef, useState } from "react";
import { supabase, setAccessToken, apiHeaders } from "./supabase.js";
import { makeT } from "./i18n.js";

// UI language follows the user's chosen target language, via this context.
const I18n = React.createContext(makeT("English"));
const useT = () => React.useContext(I18n);

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

const PLAYER_KEY = "spiewnik.player.v1";
const PROVIDER_KEY = "spiewnik.provider.v1";

const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const esc = (s) => s || "";

// The original owner — the only account the one-time Daria import is offered to.
const OWNER_ID = "4068f297-5cf7-4ab1-ba1d-93d7de2ad264";

// Map a DB row to the shape the UI uses (camelCase for media ids).
const fromRow = (r) => ({
  id: r.id, language: r.language || "Polish", artist: r.artist || "", album: r.album || "", title: r.title || "",
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

  const flash = (m) => { setToast(m); clearTimeout(flash._t); flash._t = setTimeout(() => setToast(""), 2800); };

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
    if ("language" in patch) row.language = patch.language;
    if ("pl" in patch) row.pl = patch.pl;
    if ("en" in patch) row.en = patch.en;
    if ("youtubeId" in patch) row.youtube_id = patch.youtubeId;
    if ("spotifyId" in patch) row.spotify_id = patch.spotifyId;
    row.updated_at = new Date().toISOString();
    const { error } = await supabase.from("songs").update(row).eq("id", curId);
    if (error) flash("Save didn't reach the server: " + error.message);
  }

  async function importOld() {
    flash("Importing your old songs…");
    try {
      const r = await fetch("/api/import-daria", { method: "POST", headers: apiHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Import failed");
      await loadSongs();
      flash(j.inserted ? `Imported ${j.inserted} songs` : (j.note || "Nothing new to import"));
    } catch (e) {
      flash("Import failed: " + e.message);
    }
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
          canImport={session.user.id === OWNER_ID}
          onImport={importOld}
          onOpen={(id) => { setCurId(id); setView("reader"); }}
          onAdd={() => setView("add")}
          onSettings={() => setView("settings")}
          onSignOut={() => supabase.auth.signOut()}
          onHelp={() => setView("help")}
          onFeedback={() => setView("feedback")}
        />
      )}
      {view === "help" && <Help onBack={() => setView("list")} />}
      {view === "feedback" && (
        <Feedback email={session.user.email} onBack={() => setView("list")}
          onSent={() => { setView("list"); flash(t("feedbackThanks")); }} />
      )}
      {view === "settings" && (
        <Settings profile={profile} hasOwnKey={hasOwnKey} targetLang={targetLang}
          onSave={saveDeeplKey} onSaveTarget={saveTargetLang} onBack={() => setView("list")} />
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
function ListView({ songs, loading, email, canImport, onImport, onOpen, onAdd, onSettings, onSignOut, onHelp, onFeedback }) {
  const t = useT();
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
    // Named albums first (A–Z), loose singles (blank album) last.
    lg.artists.forEach((ar) => ar.albums.sort((a, b) =>
      (a.key ? 0 : 1) - (b.key ? 0 : 1) || a.album.localeCompare(b.album)));
  });
  const done = songs.filter((s) => s.pl && s.pl.trim()).length;

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
        {loading ? (
          <div className="emptylib">{t("loading")}</div>
        ) : songs.length === 0 ? (
          <div className="emptylib">
            {t("nothingHere")}<br />{t("tapAddToStart")}
          </div>
        ) : (
          byLang.map((lg) => (
            <div key={lg.language}>
              <div className="albsect">{lg.language}</div>
              {lg.artists.map((ar) => (
                <div key={ar.artist}>
                  <div className="artsect">{ar.artist}</div>
                  {ar.albums.map((al) => (
                    <div key={al.key || "_loose"}>
                      {al.album && <div className="albumsect">{al.album}</div>}
                      <div className="songs">
                        {al.items.map((s, i) => {
                          const filled = !!(s.pl && s.pl.trim());
                          return (
                            <button key={s.id} className="song" onClick={() => onOpen(s.id)}>
                              <span className="num">{i + 1}</span>
                              <span className="meta">
                                <h3>{s.title || t("untitled")}</h3>
                                <p>{filled ? t("lines", { n: s.pl.split("\n").filter((l) => l.trim()).length }) : t("noLyricsYet")}</p>
                              </span>
                              <span className={"dot " + (filled ? "full" : "empty")} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))
        )}
        <div className="addrow"><button className="add" onClick={onAdd}>{t("addSongPlus")}</button></div>
        {canImport && (
          <div className="addrow"><button className="importbtn" onClick={onImport}>⤓ Import my old Daria ze Śląska set</button></div>
        )}
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

  async function doSearch() {
    if (!q.trim() || busy) return;
    setBusy(true); setSearched(true);
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers: apiHeaders() });
      const j = await r.json();
      setResults(Array.isArray(j.results) ? j.results : []);
    } catch { setResults([]); } finally { setBusy(false); }
  }
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
              <button className="searchbtn" onClick={doSearch} disabled={busy || !q.trim()}>{busy ? "…" : t("search")}</button>
            </div>

            <div className="results">
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
function Settings({ profile, hasOwnKey, targetLang, onSave, onSaveTarget, onBack }) {
  const t = useT();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const used = profile?.trial_used || 0;
  const save = async () => { if (!key.trim() || busy) return; setBusy(true); const ok = await onSave(key.trim()); setBusy(false); if (ok) setKey(""); };
  const remove = async () => { setBusy(true); await onSave(""); setBusy(false); };
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
      </div>
    </>
  );
}

function Help({ onBack }) {
  const t = useT();
  const items = ["Add", "Lyrics", "Translate", "Read", "Play", "Practice"];
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
  const pl = (song.pl || "").split("\n");
  const en = (song.en || "").split("\n");
  const n = Math.max(pl.length, en.length);
  const has = song.pl && song.pl.trim();
  const [yt, setYt] = useState(song.youtubeId ?? undefined);
  const [sp, setSp] = useState(song.spotifyId ?? undefined);
  const [source, setSource] = useState(() => { try { return localStorage.getItem(PLAYER_KEY) || "youtube"; } catch { return "youtube"; } });

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
          <div className="ttl"><h2>{song.title}</h2><p>{[song.artist, song.language].filter(Boolean).join(" · ")}</p></div>
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
        <div className="sheethead"><span>{song.language}</span><span>{targetLang || "English"}</span></div>
        {!has ? (
          <div className="emptysheet">{t("noLyricsHere")}<br />{t("tapEditToPaste")}</div>
        ) : (
          <div className="grid">
            {Array.from({ length: n }).map((_, i) => {
              const p = (pl[i] || "").trim(), e = (en[i] || "").trim();
              if (!p && !e) return <React.Fragment key={i}><div className="cell gap pl" /><div className="cell gap en" /></React.Fragment>;
              return (
                <React.Fragment key={i}>
                  <div className="cell pl">{esc(p) || " "}</div>
                  <div className="cell en">{esc(e) || " "}</div>
                </React.Fragment>
              );
            })}
          </div>
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

function Practice({ song, onBack }) {
  const tr = useT();
  const bcp = langOf(song.language).bcp;
  const lines = React.useMemo(() => {
    const pl = (song.pl || "").split("\n");
    const en = (song.en || "").split("\n");
    return pl.map((s, i) => ({ pl: s.trim(), en: (en[i] || "").trim() })).filter((l) => l.pl);
  }, [song.id]);
  const [idx, setIdx] = useState(0);
  const [heard, setHeard] = useState("");
  const [score, setScore] = useState(null);
  const [listening, setListening] = useState(false);
  const [showEn, setShowEn] = useState(false);
  const recRef = useRef(null);
  const Rec = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);
  const line = lines[idx];

  useEffect(() => () => { try { recRef.current?.stop(); window.speechSynthesis?.cancel(); } catch {} }, []);

  if (!line) return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>{tr("practice")}</h2><p>{song.title}</p></div>
      </div>
      <div className="prac"><p className="pracnote">{tr("noPracticeYet")}</p></div>
    </>
  );

  const speak = () => {
    try {
      const synth = window.speechSynthesis; synth.cancel();
      const u = new SpeechSynthesisUtterance(line.pl);
      u.lang = bcp; u.rate = 0.9;
      const v = synth.getVoices().find((x) => x.lang && x.lang.toLowerCase().startsWith(bcp.slice(0, 2)));
      if (v) u.voice = v;
      synth.speak(u);
    } catch {}
  };
  const listen = () => {
    if (!Rec) return;
    const rec = new Rec(); recRef.current = rec;
    rec.lang = bcp; rec.interimResults = false; rec.maxAlternatives = 1;
    setHeard(""); setScore(null); setListening(true);
    rec.onresult = (e) => { const t = e.results[0][0].transcript; setHeard(t); setScore(grade(line.pl, t)); };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    try { rec.start(); } catch { setListening(false); }
  };
  const stopListen = () => { try { recRef.current?.stop(); } catch {} setListening(false); };
  const go = (d) => { stopListen(); setHeard(""); setScore(null); setShowEn(false); setIdx((i) => Math.min(lines.length - 1, Math.max(0, i + d))); };

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
        <div className="pracbtns">
          <button className="pracbtn" onClick={speak}>{tr("listen")}</button>
          {Rec ? (
            <button className={"pracbtn mic" + (listening ? " on" : "")} onClick={listening ? stopListen : listen}>
              {listening ? tr("listeningStop") : tr("speak")}
            </button>
          ) : null}
        </div>
        {heard && (
          <div className="pracfb">
            <div className="pracpct" data-good={!!(score && score.pct >= 70)}>{score ? score.pct : 0}% match</div>
            <div className="pracheard">You said: “{heard}”</div>
          </div>
        )}
        {!Rec && <p className="pracnote">Speaking feedback needs Chrome or an Android phone. You can still tap Listen and read along.</p>}
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
  const [language, setLanguage] = useState(song.language || "Polish");
  const [pl, setPl] = useState(song.pl || "");
  const [en, setEn] = useState(song.en || "");
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [trialOut, setTrialOut] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);

  // Try to pull the original lyric automatically (lyrics.ovh via /api/lyrics).
  // `auto` = called silently on open; otherwise it's the button, which reports.
  async function fetchLyrics(auto) {
    if (!title.trim() || !artist.trim()) { if (!auto) flash(t("tAddArtistFirst")); return; }
    setFetching(true);
    try {
      const r = await fetch(`/api/lyrics?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`, { headers: apiHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Lookup failed");
      if (j.lyrics && j.lyrics.trim()) {
        setPl((cur) => (cur && cur.trim() ? cur : j.lyrics.trim())); // never clobber typed text
        if (!auto) flash(t("tLyricsFound"));
      } else if (!auto) {
        flash(t("tLyricsNone"));
      }
    } catch (e) {
      if (!auto) flash("Lyric lookup failed: " + e.message);
    } finally {
      setFetching(false);
    }
  }
  // On opening a song that has no lyrics yet, have a go automatically.
  useEffect(() => { if (!(song.pl || "").trim()) fetchLyrics(true); /* eslint-disable-next-line */ }, []);

  async function autoTranslate() {
    const lines = pl.split("\n");
    if (!pl.trim()) { flash(t("tPasteFirst")); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/translate", {
        method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
        body: JSON.stringify({ lines, source: langOf(language).code, target: langOf(targetLang || "English").code, provider }),
      });
      if (r.status === 402) { setTrialOut(true); setBusy(false); return; } // free trial used up
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Translation failed");
      setEn((j.translations || []).join("\n"));
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
          <div><label>{t("title")}</label><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><label>{t("artist")}</label><input value={artist} onChange={(e) => setArtist(e.target.value)} /></div>
          <div><label>{t("album")} <span className="opt">{t("optional")}</span></label><input value={album} onChange={(e) => setAlbum(e.target.value)} /></div>
          <div><label>{t("language")}</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGS.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
            </select>
          </div>
        </div>
        <div className="cols">
          <div>
            <label>{language} <span className="opt">{t("pasteWhole")}</span></label>
            <textarea value={pl} onChange={(e) => setPl(e.target.value)} placeholder={fetching ? t("fetching") : t("pasteWhole")} />
            <div className="lyrrow">
              <a className="findbtn" href={findUrl} target="_blank" rel="noreferrer">{t("findGoogle")}</a>
              <button className="fetch" onClick={() => fetchLyrics(false)} disabled={fetching}>{fetching ? t("fetching") : t("autoFetch")}</button>
            </div>
            <p className="findhint">{t("findHint")}</p>
          </div>
          <div>
            <label>{targetLang || "English"} <span className="opt">{t("autoOrType")}</span></label>
            <textarea className="en" value={en} onChange={(e) => setEn(e.target.value)} placeholder={t("autoOrType")} />
            <div className="trrow">
              <button className="tr" onClick={autoTranslate} disabled={busy}>{busy ? t("translating") : t("autoTranslate")}</button>
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
          <button className="save" onClick={() => onSave({ title: title.trim() || song.title, artist: artist.trim(), album: album.trim(), language, pl, en })}>{t("save")}</button>
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
.albsect{ font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--mist-dim); padding:20px 4px 10px; display:flex; align-items:center; gap:10px; }
.albsect::after{ content:""; flex:1; height:1px; background:var(--line); }
.artsect{ font-family:var(--display); font-weight:600; font-size:15px; color:#e4d9c6; padding:12px 4px 8px; }
.albumsect{ font-family:var(--ui); font-weight:500; font-style:italic; font-size:12.5px; color:var(--mist-dim); padding:6px 4px 4px 14px; }
.songs{ display:flex; flex-direction:column; gap:8px; }
.song{ width:100%; text-align:left; cursor:pointer; background:var(--night-2); border:1px solid var(--line); border-radius:14px; padding:14px 16px; display:flex; align-items:center; gap:14px; color:inherit; font-family:inherit; transition:border-color .16s, transform .1s; }
.song:hover{ border-color:var(--night-3); } .song:active{ transform:scale(.995); }
.num{ font-family:var(--display); font-weight:700; font-size:14px; color:var(--mist-dim); width:22px; flex:none; text-align:right; font-variant-numeric:tabular-nums; }
.song .meta{ flex:1; min-width:0; }
.song .meta h3{ margin:0; font-family:var(--display); font-weight:600; font-size:17px; color:#f0ebe0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.song .meta p{ margin:2px 0 0; font-size:12px; color:var(--mist-dim); }
.dot{ width:9px; height:9px; border-radius:50%; flex:none; } .dot.full{ background:var(--rose); } .dot.empty{ background:none; border:1.5px solid var(--night-3); }
.addrow{ margin-top:14px; } .add{ width:100%; background:none; border:1.5px dashed var(--night-3); color:var(--rose); border-radius:14px; padding:13px; font-family:var(--ui); font-size:14px; cursor:pointer; } .add:hover{ border-color:var(--rose); }
.importbtn{ width:100%; background:var(--night-2); border:1px solid var(--line); color:var(--mist); border-radius:14px; padding:12px; font-family:var(--ui); font-size:13px; cursor:pointer; } .importbtn:hover{ border-color:var(--rose); color:#f0ebe0; }
.rbar{ display:flex; align-items:center; gap:10px; padding:16px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--night); z-index:3; }
.icbtn{ background:var(--night-2); border:1px solid var(--line); color:var(--mist); border-radius:10px; height:38px; min-width:38px; padding:0 12px; cursor:pointer; font-size:14px; font-family:var(--ui); line-height:1; }
.icbtn.accent{ background:var(--rose); border-color:var(--rose); color:#20140f; font-weight:600; }
.rbar .ttl{ flex:1; min-width:0; } .rbar .ttl h2{ margin:0; font-family:var(--display); font-weight:900; font-size:19px; color:#f3ede1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .rbar .ttl p{ margin:2px 0 0; font-size:12px; color:var(--mist-dim); }
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
.editor{ padding:16px; }
.editor .cols{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.editor label{ display:block; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--mist-dim); margin:0 0 7px; }
.editor .opt{ text-transform:none; letter-spacing:0; font-weight:400; color:var(--mist-dim); margin-left:6px; }
.editor textarea{ width:100%; min-height:300px; background:var(--night-2); border:1px solid var(--line); border-radius:12px; padding:12px 13px; color:#eef1f6; font-size:14px; line-height:1.55; outline:0; resize:vertical; font-family:var(--serif); }
.editor textarea.en{ font-family:var(--ui); } .editor textarea:focus{ border-color:var(--rose); }
.lyrrow{ display:flex; align-items:center; gap:10px; margin-top:10px; flex-wrap:wrap; }
.editor .findbtn{ background:var(--rose); color:#20140f; border:0; border-radius:10px; padding:10px 16px; font-family:var(--ui); font-size:13px; font-weight:600; cursor:pointer; text-decoration:none; display:inline-block; }
.editor .fetch{ background:var(--night-3); border:1px solid var(--line); color:#eef1f6; border-radius:10px; padding:10px 14px; font-family:var(--ui); font-size:13px; font-weight:500; cursor:pointer; } .editor .fetch:disabled{ opacity:.55; cursor:default; }
.editor .findhint{ font-size:11.5px; color:var(--mist-dim); margin:8px 2px 0; line-height:1.5; }
.trrow{ display:flex; gap:8px; margin-top:8px; }
.trrow .tr{ flex:1; background:var(--night-3); border:1px solid var(--line); color:#eef1f6; border-radius:10px; padding:10px; font-family:var(--ui); font-size:13px; font-weight:500; cursor:pointer; }
.trrow .tr:disabled{ opacity:.55; cursor:default; }
.trrow select{ background:var(--night-2); border:1px solid var(--line); color:var(--mist); border-radius:10px; padding:0 10px; font-family:var(--ui); font-size:13px; outline:0; }
.editor .meta3{ display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px; }
.addform{ display:flex; flex-direction:column; gap:14px; margin-bottom:6px; }
.addlang{ margin-bottom:16px; }
.searchlabel{ display:block; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--mist-dim); margin:0 0 7px; }
.searchrow{ display:flex; gap:8px; }
.searchrow input{ flex:1; }
.searchbtn{ background:var(--rose); color:#20140f; border:0; border-radius:11px; padding:0 18px; font-family:var(--ui); font-size:14px; font-weight:600; cursor:pointer; } .searchbtn:disabled{ opacity:.5; cursor:default; }
.results{ display:flex; flex-direction:column; gap:8px; margin-top:14px; }
.sresult{ width:100%; text-align:left; cursor:pointer; background:var(--night-2); border:1px solid var(--line); border-radius:12px; padding:12px 14px; display:flex; align-items:center; gap:12px; color:inherit; font-family:inherit; }
.sresult:hover{ border-color:var(--rose); } .sresult:disabled{ opacity:.6; }
.sresult .meta{ flex:1; min-width:0; } .sresult .meta h3{ margin:0; font-family:var(--display); font-weight:600; font-size:16px; color:#f0ebe0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .sresult .meta p{ margin:2px 0 0; font-size:12px; color:var(--mist-dim); }
.pickarrow{ flex:none; color:var(--rose); font-size:18px; font-weight:600; }
.noresults{ color:var(--mist-dim); font-size:13px; text-align:center; padding:20px; }
.manuallink{ display:block; margin:18px auto 0; background:none; border:0; color:var(--rose); font-size:13px; cursor:pointer; }
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
.pracbtns{ display:flex; gap:10px; justify-content:center; margin:28px 0 6px; }
.pracbtn{ background:var(--night-2); border:1px solid var(--line); color:#eef1f6; border-radius:12px; padding:13px 24px; font-size:15px; font-family:var(--ui); font-weight:500; cursor:pointer; }
.pracbtn.mic.on{ background:var(--rose); border-color:var(--rose); color:#20140f; }
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
