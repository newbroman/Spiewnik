import React, { useEffect, useRef, useState } from "react";
import { supabase, setAccessToken, apiHeaders } from "./supabase.js";

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
  id: r.id, language: r.language || "Polish", artist: r.artist || "", title: r.title || "",
  pl: r.pl || "", en: r.en || "", youtubeId: r.youtube_id, spotifyId: r.spotify_id, position: r.position ?? 0,
});

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = checking
  const [songs, setSongs] = useState([]);
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
  useEffect(() => { if (session) loadSongs(); else { setSongs([]); setLoading(false); } }, [session?.user?.id]);

  useEffect(() => { try { localStorage.setItem(PROVIDER_KEY, provider); } catch {} }, [provider]);

  const cur = songs.find((s) => s.id === curId);

  // --- CRUD against Supabase (RLS scopes every row to this user) -------------
  async function createSong({ language, artist, title }) {
    const position = songs.reduce((m, s) => Math.max(m, s.position || 0), 0) + 1;
    const { data, error } = await supabase
      .from("songs").insert({ language, artist, title, pl: "", en: "", position })
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
    flash(error ? "Couldn't remove: " + error.message : "Song removed");
  }

  if (session === undefined) {
    return <Shell><div className="splash">Śpiewnik…</div></Shell>;
  }
  if (session === null) {
    return <Shell><Auth flash={flash} /><Toast toast={toast} /></Shell>;
  }

  return (
    <Shell>
      {view === "list" && (
        <ListView
          songs={songs} loading={loading} email={session.user.email}
          canImport={session.user.id === OWNER_ID}
          onImport={importOld}
          onOpen={(id) => { setCurId(id); setView("reader"); }}
          onAdd={() => setView("add")}
          onSignOut={() => supabase.auth.signOut()}
        />
      )}
      {view === "add" && <AddSong onBack={() => setView("list")} onCreate={createSong} />}
      {view === "reader" && cur && (
        <Reader song={cur} onBack={() => setView("list")} onEdit={() => setView("edit")}
          onPractice={() => setView("practice")} onFoundMedia={(patch) => saveSong(patch)} />
      )}
      {view === "practice" && cur && <Practice song={cur} onBack={() => setView("reader")} />}
      {view === "edit" && cur && (
        <Editor song={cur} provider={provider} setProvider={setProvider}
          onBack={() => setView("reader")}
          onSave={(patch) => { saveSong(patch); setView("reader"); flash("Saved"); }}
          onRemove={() => removeSong(cur.id)} flash={flash} />
      )}
      <Toast toast={toast} />
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="kl-root">
      <style>{CSS}</style>
      <div className="app">{children}</div>
    </div>
  );
}
function Toast({ toast }) {
  return <div className={"kl-toast" + (toast ? " show" : "")}>{toast}</div>;
}

// ---- Sign in / sign up ------------------------------------------------------
function Auth({ flash }) {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");

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
        <div className="eyebrow">Learn a language through song</div>
        <h1>Śpiewnik</h1>
        <p>{mode === "signup" ? "Create an account — your songs stay private to you." : "Sign in to your song library."}</p>
        <input type="email" value={email} autoFocus placeholder="Email" autoComplete="email"
          onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <input type="password" value={pw} placeholder="Password" style={{ marginTop: 10 }}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        {err && <div className="lockerr">{err}</div>}
        {note && <div className="locknote">{note}</div>}
        <button onClick={submit} disabled={busy}>
          {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
        <button className="linkbtn" onClick={() => { setErr(""); setNote(""); setMode(mode === "signup" ? "signin" : "signup"); }}>
          {mode === "signup" ? "Have an account? Sign in" : "New here? Create an account"}
        </button>
      </div>
    </div>
  );
}

// ---- Library list -----------------------------------------------------------
function ListView({ songs, loading, email, canImport, onImport, onOpen, onAdd, onSignOut }) {
  // Group by language, then show the artist on each row.
  const groups = [];
  songs.forEach((s) => {
    let g = groups.find((x) => x.language === s.language);
    if (!g) { g = { language: s.language, items: [] }; groups.push(g); }
    g.items.push(s);
  });
  const done = songs.filter((s) => s.pl && s.pl.trim()).length;

  return (
    <>
      <div className="top">
        <div className="toprow">
          <div className="eyebrow">Your song library</div>
          <button className="signout" onClick={onSignOut}>Sign out</button>
        </div>
        <h1>Śpiewnik</h1>
        <p>{songs.length === 0
          ? "Add your first song — any artist, any language — then read it line by line."
          : `${done} of ${songs.length} filled in. Signed in as ${email}.`}</p>
      </div>
      <div className="body">
        {loading ? (
          <div className="emptylib">Loading your songs…</div>
        ) : songs.length === 0 ? (
          <div className="emptylib">
            Nothing here yet.<br />Tap <b>Add a song</b> to start your library.
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.language}>
              <div className="albsect">{g.language}</div>
              <div className="songs">
                {g.items.map((s, i) => {
                  const filled = !!(s.pl && s.pl.trim());
                  return (
                    <button key={s.id} className="song" onClick={() => onOpen(s.id)}>
                      <span className="num">{i + 1}</span>
                      <span className="meta">
                        <h3>{s.title || "Untitled"}</h3>
                        <p>{s.artist ? s.artist + " · " : ""}{filled ? s.pl.split("\n").filter((l) => l.trim()).length + " lines" : "No lyrics yet — tap to add"}</p>
                      </span>
                      <span className={"dot " + (filled ? "full" : "empty")} />
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
        <div className="addrow"><button className="add" onClick={onAdd}>+ Add a song</button></div>
        {canImport && (
          <div className="addrow"><button className="importbtn" onClick={onImport}>⤓ Import my old Daria ze Śląska set</button></div>
        )}
      </div>
    </>
  );
}

// ---- Add a song -------------------------------------------------------------
function AddSong({ onBack, onCreate }) {
  const [language, setLanguage] = useState("Polish");
  const [artist, setArtist] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    await onCreate({ language, artist: artist.trim(), title: title.trim() });
  };
  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>Add a song</h2><p>Any artist, any language</p></div>
      </div>
      <div className="editor">
        <div className="addform">
          <div><label>Language</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGS.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
            </select>
          </div>
          <div><label>Artist</label>
            <input value={artist} placeholder="e.g. Daria ze Śląska" onChange={(e) => setArtist(e.target.value)} />
          </div>
          <div><label>Title</label>
            <input value={title} autoFocus placeholder="Song title" onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()} />
          </div>
        </div>
        <div className="actions">
          <button className="save" onClick={create} disabled={busy}>{busy ? "Adding…" : "Add & paste lyrics"}</button>
          <button className="cancel" onClick={onBack}>Cancel</button>
        </div>
      </div>
    </>
  );
}

// ---- Reader (side-by-side + player + auto-scroll) ---------------------------
function Reader({ song, onBack, onEdit, onPractice, onFoundMedia }) {
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
          {has ? <button className="icbtn" onClick={onPractice}>Practice</button> : null}
          <button className="icbtn accent" onClick={onEdit}>Edit</button>
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
                  {autoScroll ? "Auto-scroll ●" : "Auto-scroll"}
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
        <div className="sheethead"><span>{song.language}</span><span>English</span></div>
        {!has ? (
          <div className="emptysheet">No lyrics here yet.<br />Tap <b>Edit</b> to paste the original, then Auto-translate or type the English.</div>
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
        <div className="ttl"><h2>Practice</h2><p>{song.title}</p></div>
      </div>
      <div className="prac"><p className="pracnote">No lyrics to practise yet — add them under Edit first.</p></div>
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
        <div className="ttl"><h2>Practice</h2><p>{song.title} · {idx + 1}/{lines.length}</p></div>
      </div>
      <div className="prac">
        <div className="pracline">
          {score ? score.marks.map((m, i) => <span key={i} className={m.ok ? "wok" : "wno"}>{m.w}{" "}</span>) : line.pl}
        </div>
        {showEn && <div className="pracen">{line.en || "—"}</div>}
        <button className="pracen-toggle" onClick={() => setShowEn((v) => !v)}>{showEn ? "Hide meaning" : "Show meaning"}</button>
        <div className="pracbtns">
          <button className="pracbtn" onClick={speak}>Listen</button>
          {Rec ? (
            <button className={"pracbtn mic" + (listening ? " on" : "")} onClick={listening ? stopListen : listen}>
              {listening ? "Listening… stop" : "Speak"}
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
          <button className="navbtn" onClick={() => go(-1)} disabled={idx === 0}>← Prev</button>
          <button className="navbtn" onClick={() => go(1)} disabled={idx === lines.length - 1}>Next →</button>
        </div>
      </div>
    </>
  );
}

// ---- Editor -----------------------------------------------------------------
function Editor({ song, provider, setProvider, onBack, onSave, onRemove, flash }) {
  const [title, setTitle] = useState(song.title);
  const [artist, setArtist] = useState(song.artist || "");
  const [language, setLanguage] = useState(song.language || "Polish");
  const [pl, setPl] = useState(song.pl || "");
  const [en, setEn] = useState(song.en || "");
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);

  // Try to pull the original lyric automatically (lyrics.ovh via /api/lyrics).
  // `auto` = called silently on open; otherwise it's the button, which reports.
  async function fetchLyrics(auto) {
    if (!title.trim() || !artist.trim()) { if (!auto) flash("Add the artist and title first"); return; }
    setFetching(true);
    try {
      const r = await fetch(`/api/lyrics?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`, { headers: apiHeaders() });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Lookup failed");
      if (j.lyrics && j.lyrics.trim()) {
        setPl((cur) => (cur && cur.trim() ? cur : j.lyrics.trim())); // never clobber typed text
        if (!auto) flash("Lyrics found — check them over, then Auto-translate");
      } else if (!auto) {
        flash("No lyrics found automatically — use Find or paste them in");
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
    if (!pl.trim()) { flash("Paste the original lyrics first"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/translate", {
        method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
        body: JSON.stringify({ lines, source: langOf(language).code, target: "EN", provider }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Translation failed");
      setEn((j.translations || []).join("\n"));
      flash(`Translated with ${j.provider === "google" ? "Google" : "DeepL"} — check it over`);
    } catch (e) {
      flash("Couldn't translate: " + e.message);
    } finally {
      setBusy(false);
    }
  }

  const findUrl = "https://www.google.com/search?q=" + encodeURIComponent(`${artist} ${title || ""} ${language === "Polish" ? "tekst" : "lyrics"}`.trim());

  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>Edit</h2><p>{song.title}</p></div>
      </div>
      <div className="editor">
        <div className="meta3">
          <div><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><label>Artist</label><input value={artist} onChange={(e) => setArtist(e.target.value)} /></div>
          <div><label>Language</label>
            <select value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGS.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
            </select>
          </div>
        </div>
        <div className="cols">
          <div>
            <label>{language} <span className="opt">paste the whole lyric</span></label>
            <textarea value={pl} onChange={(e) => setPl(e.target.value)} placeholder={fetching ? "Looking for the lyrics…" : "Paste the full lyric here —\nall the lines at once."} />
            <div className="lyrrow">
              <a className="findbtn" href={findUrl} target="_blank" rel="noreferrer">🔍 Find lyrics on Google ↗</a>
              <button className="fetch" onClick={() => fetchLyrics(false)} disabled={fetching}>{fetching ? "Fetching…" : "⤓ Auto-fetch"}</button>
            </div>
            <p className="findhint">Opens a search for this song — copy the lyric from the results (e.g. tekstowo.pl) and paste it above.</p>
          </div>
          <div>
            <label>English <span className="opt">auto or type</span></label>
            <textarea className="en" value={en} onChange={(e) => setEn(e.target.value)} placeholder={"Auto-translate, or type the English\nlined up with the original."} />
            <div className="trrow">
              <button className="tr" onClick={autoTranslate} disabled={busy}>{busy ? "Translating…" : "⟳ Auto-translate"}</button>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Translation provider">
                <option value="deepl">DeepL</option>
                <option value="google">Google</option>
              </select>
            </div>
          </div>
        </div>
        <p className="hint2">Auto-translate goes line-for-line, so the columns stay aligned. Machine translation is a rough first draft — fixing it by hand is where the learning is.</p>
        <div className="actions">
          <button className="save" onClick={() => onSave({ title: title.trim() || song.title, artist: artist.trim(), language, pl, en })}>Save</button>
          <button className="cancel" onClick={onBack}>Cancel</button>
        </div>
        <button className="danger" onClick={onRemove}>Remove this song</button>
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
.toprow{ display:flex; align-items:center; justify-content:space-between; }
.signout{ background:var(--night-2); border:1px solid var(--line); color:var(--mist-dim); border-radius:9px; padding:6px 12px; font-size:12px; font-family:var(--ui); cursor:pointer; }
.eyebrow{ font-size:11px; letter-spacing:.2em; text-transform:uppercase; color:var(--rose); font-weight:600; }
.top h1{ font-family:var(--display); font-weight:900; font-size:30px; letter-spacing:-.02em; color:#f3ede1; margin:4px 0 0; line-height:1.02; }
.top p{ margin:7px 0 0; font-size:13px; color:var(--mist-dim); }
.body{ flex:1; padding:6px 16px 60px; }
.emptylib{ text-align:center; color:var(--mist-dim); padding:48px 20px; font-size:14px; line-height:1.6; } .emptylib b{ color:#f0ebe0; }
.albsect{ font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--mist-dim); padding:20px 4px 10px; display:flex; align-items:center; gap:10px; }
.albsect::after{ content:""; flex:1; height:1px; background:var(--line); }
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
.editor .meta3{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin-bottom:14px; }
.addform{ display:flex; flex-direction:column; gap:14px; margin-bottom:6px; }
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
