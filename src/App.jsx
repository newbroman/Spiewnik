import React, { useState } from "react";

// ============================================================================
//  Śpiewnik — a Polish lyrics language-learning app
//  Line-by-line Polish / English for study, built around a "reveal" loop.
//
//  CONTENT & COPYRIGHT
//  -------------------
//  Song lyrics are copyrighted. This app does NOT bundle any real lyrics.
//  It fetches them at runtime from Musixmatch, a licensed lyrics provider.
//  The "Sample lesson" below is ORIGINAL text written for this demo so you
//  can try the interface without a backend — it is not a real song.
//
//  HOW THE API IS WIRED
//  --------------------
//  The app calls its own /api/musixmatch endpoint (the serverless function in
//  api/musixmatch.js). On Vercel the app and that function share an origin, so
//  there's no CORS issue and nothing to configure in the UI — just set
//  MUSIXMATCH_API_KEY in the Vercel project. The Settings field is only an
//  optional override for hosting the proxy elsewhere.
//  Free Musixmatch plans return ~30% of each lyric; full lyrics need a paid plan.
// ============================================================================

const DEFAULT_BASE = "/api/musixmatch"; // same-origin serverless function

function mxUrl(base, path, params) {
  const qs = new URLSearchParams({ path, ...params }).toString();
  return `${base.replace(/\/+$/, "")}?${qs}`;
}

async function mxSearchTracks(base, query) {
  const url = mxUrl(base, "track.search", {
    q: query,
    f_has_lyrics: "1",
    page_size: "12",
    s_track_rating: "desc",
  });
  const res = await fetch(url);
  const json = await res.json();
  if (json?.message?.header?.status_code !== 200) {
    throw new Error(`Musixmatch status ${json?.message?.header?.status_code}`);
  }
  return (json.message.body.track_list || []).map((t) => ({
    id: String(t.track.track_id),
    title: t.track.track_name,
    artist: t.track.artist_name,
    album: t.track.album_name,
  }));
}

async function mxGetLyrics(base, trackId) {
  const [lyricsRes, transRes] = await Promise.all([
    fetch(mxUrl(base, "track.lyrics.get", { track_id: trackId })),
    fetch(mxUrl(base, "track.lyrics.translation.get", { track_id: trackId, selected_language: "en" })),
  ]);
  const lyricsJson = await lyricsRes.json();
  const transJson = await transRes.json();

  const body = lyricsJson?.message?.body?.lyrics?.lyrics_body || "";
  const restricted = !!lyricsJson?.message?.body?.lyrics?.restricted;

  // Musixmatch appends a tracking/disclaimer line — strip it for display.
  const clean = body.replace(/\*+.*This Lyrics.*$/is, "").trim();
  const plLines = clean.split("\n").filter((l) => l.trim().length > 0);

  // Build a lookup of original snippet -> english from the translation list.
  const translations = transJson?.message?.body?.translations_list || [];
  const map = new Map();
  translations.forEach((tr) => {
    const t = tr.translation;
    if (t?.snippet) map.set(t.snippet.trim(), t.description);
  });

  return {
    partial: restricted,
    lines: plLines.map((pl) => ({ pl, en: map.get(pl.trim()) || "" })),
  };
}

// ---- Original sample content (NOT a real song — written for this demo) ------
const SAMPLE = {
  id: "sample",
  title: "Wieczór nad rzeką",
  artist: "Sample lesson",
  album: "Original demo text",
  sample: true,
  lines: [
    { pl: "Słońce zachodzi nad cichą rzeką.", en: "The sun sets over the quiet river." },
    { pl: "Wiatr niesie zapach mokrej trawy.", en: "The wind carries the smell of wet grass." },
    { pl: "Siedzę na brzegu i liczę gwiazdy.", en: "I sit on the bank and count the stars." },
    { pl: "Miasto śpi, a ja wciąż nie mogę zasnąć.", en: "The city sleeps, but I still can't fall asleep." },
    { pl: "Twoje imię brzmi jak stara piosenka.", en: "Your name sounds like an old song." },
    { pl: "Może jutro znów cię zobaczę.", en: "Maybe tomorrow I'll see you again." },
    { pl: "Woda płynie powoli w stronę morza.", en: "The water flows slowly toward the sea." },
    { pl: "Zostaję tu, aż noc zamieni się w świt.", en: "I stay here until the night turns into dawn." },
  ],
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=Inter:wght@400;500;600&display=swap');

.kl-root{
  --night:#1a2130; --night-2:#232c3f; --night-3:#2b3650;
  --line:rgba(255,255,255,.08);
  --paper:#f5f0e6; --paper-edge:#e6ddcc; --paper-2:#ede6d7;
  --ink:#23262d; --ink-soft:#6a6c74;
  --mist:#b3bccb; --mist-dim:#7c8698;
  --rose:#d67c70; --rose-deep:#c0655a;
  --serif:'Newsreader',Georgia,serif;
  --display:'Fraunces',Georgia,serif;
  --ui:'Inter',system-ui,sans-serif;
  min-height:100vh; background:
    radial-gradient(120% 80% at 50% -10%, #26304a 0%, var(--night) 55%);
  display:flex; justify-content:center; padding:0;
  font-family:var(--ui); color:var(--mist);
  -webkit-font-smoothing:antialiased;
}
*{box-sizing:border-box;}
.kl-phone{
  width:100%; max-width:440px; min-height:100vh; position:relative;
  display:flex; flex-direction:column; background:var(--night);
  box-shadow:0 0 80px rgba(0,0,0,.5);
}
@media(min-width:520px){ .kl-phone{ min-height:92vh; margin:4vh 0; border-radius:28px; overflow:hidden; } }

.kl-top{ padding:22px 22px 14px; border-bottom:1px solid var(--line); }
.kl-brand{ display:flex; align-items:baseline; gap:9px; }
.kl-brand h1{
  font-family:var(--display); font-optical-sizing:auto; font-weight:900;
  font-size:26px; letter-spacing:-.02em; color:#f3ede1; margin:0; line-height:1;
}
.kl-brand span{ font-size:12px; color:var(--rose); font-weight:600; letter-spacing:.14em; text-transform:uppercase; }
.kl-sub{ margin:6px 0 0; font-size:12.5px; color:var(--mist-dim); }

.kl-body{ flex:1; overflow-y:auto; -webkit-overflow-scrolling:touch; }

.kl-search-wrap{ padding:16px 18px 6px; }
.kl-search{
  display:flex; align-items:center; gap:10px; background:var(--night-2);
  border:1px solid var(--line); border-radius:14px; padding:11px 14px;
}
.kl-search input{
  flex:1; background:transparent; border:0; outline:0; color:#eef1f6;
  font-family:var(--ui); font-size:15px;
}
.kl-search input::placeholder{ color:var(--mist-dim); }
.kl-search button{
  background:var(--rose); color:#20140f; border:0; border-radius:9px;
  padding:7px 13px; font-family:var(--ui); font-weight:600; font-size:13px; cursor:pointer;
}
.kl-search button:disabled{ opacity:.5; cursor:default; }

.kl-note{ margin:10px 18px 0; font-size:11.5px; line-height:1.5; color:var(--mist-dim);
  background:var(--night-2); border:1px solid var(--line); border-radius:11px; padding:10px 12px; }
.kl-note b{ color:var(--rose); font-weight:600; }

.kl-sect{ padding:20px 18px 6px; font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--mist-dim); }

.kl-list{ padding:4px 14px 24px; display:flex; flex-direction:column; gap:9px; }
.kl-card{
  text-align:left; width:100%; cursor:pointer; background:var(--night-2);
  border:1px solid var(--line); border-radius:15px; padding:14px 16px;
  display:flex; align-items:center; gap:14px; transition:border-color .18s, transform .12s;
  color:inherit; font-family:inherit;
}
.kl-card:hover{ border-color:var(--night-3); }
.kl-card:active{ transform:scale(.99); }
.kl-badge{
  width:42px; height:42px; border-radius:11px; flex:none; display:grid; place-items:center;
  font-family:var(--display); font-weight:900; font-size:19px; color:#20140f;
  background:linear-gradient(150deg,#e8b7a0,var(--rose));
}
.kl-card-txt{ min-width:0; }
.kl-card-txt h3{ margin:0; font-family:var(--display); font-weight:600; font-size:16.5px; color:#f0ebe0;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.kl-card-txt p{ margin:2px 0 0; font-size:12.5px; color:var(--mist-dim);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.kl-tag{ font-size:10px; color:var(--rose); border:1px solid var(--rose); border-radius:20px;
  padding:2px 8px; margin-left:auto; flex:none; letter-spacing:.06em; }

.kl-empty{ padding:40px 24px; text-align:center; color:var(--mist-dim); font-size:13.5px; line-height:1.6; }

.kl-reader-top{ padding:16px 18px 14px; border-bottom:1px solid var(--line); display:flex; align-items:flex-start; gap:12px; }
.kl-back{ background:var(--night-2); border:1px solid var(--line); color:var(--mist); border-radius:10px;
  width:36px; height:36px; flex:none; cursor:pointer; font-size:17px; line-height:1; }
.kl-reader-top h2{ margin:0; font-family:var(--display); font-weight:900; font-size:21px; color:#f3ede1; letter-spacing:-.01em; }
.kl-reader-top p{ margin:3px 0 0; font-size:12.5px; color:var(--mist-dim); }

.kl-controls{ display:flex; gap:8px; padding:12px 18px; border-bottom:1px solid var(--line); }
.kl-chip{ flex:1; background:var(--night-2); border:1px solid var(--line); color:var(--mist);
  border-radius:10px; padding:9px 6px; font-family:var(--ui); font-size:12.5px; font-weight:500; cursor:pointer;
  transition:.15s; }
.kl-chip.on{ background:var(--rose); border-color:var(--rose); color:#20140f; }

.kl-page{ padding:14px 16px 40px; }
.kl-line{
  background:var(--paper); border-radius:14px; padding:15px 16px 14px; margin:0 0 10px;
  border-left:3px solid transparent; cursor:pointer; position:relative;
  transition:border-color .2s, opacity .25s, filter .25s;
}
.kl-line.dim{ opacity:.34; filter:saturate(.6); }
.kl-line.active{ border-left-color:var(--rose); }
.kl-pl{ font-family:var(--serif); font-weight:500; font-size:19px; line-height:1.4; color:var(--ink); }
.kl-en{
  overflow:hidden; max-height:0; opacity:0; transition:max-height .28s ease, opacity .28s ease, margin .28s;
  font-family:var(--ui); font-size:14px; line-height:1.45; color:var(--ink-soft); margin-top:0;
}
.kl-en.show{ max-height:120px; opacity:1; margin-top:9px; }
.kl-en.blank{ font-style:italic; color:#a99; }
.kl-hint{ position:absolute; top:14px; right:14px; font-size:10px; color:#b3a893; letter-spacing:.08em;
  text-transform:uppercase; opacity:.8; }
.kl-line.revealed .kl-hint{ display:none; }

.kl-partial{ margin:2px 16px 20px; font-size:12px; line-height:1.5; color:var(--mist-dim);
  border:1px dashed var(--night-3); border-radius:11px; padding:11px 13px; }

.kl-set{ padding:20px 18px 40px; }
.kl-set h2{ font-family:var(--display); font-weight:900; font-size:22px; color:#f3ede1; margin:0 0 4px; }
.kl-set label{ display:block; font-size:12px; letter-spacing:.1em; text-transform:uppercase;
  color:var(--mist-dim); margin:18px 0 7px; }
.kl-set input{ width:100%; background:var(--night-2); border:1px solid var(--line); border-radius:12px;
  padding:13px 14px; color:#eef1f6; font-family:var(--ui); font-size:15px; outline:0; }
.kl-set input:focus{ border-color:var(--rose); }
.kl-status{ margin-top:12px; font-size:13px; padding:11px 13px; border-radius:11px; }
.kl-status.ok{ background:rgba(214,124,112,.12); color:#e7a89e; border:1px solid rgba(214,124,112,.3); }
.kl-status.off{ background:var(--night-2); color:var(--mist-dim); border:1px solid var(--line); }
.kl-help{ margin-top:20px; font-size:12.5px; line-height:1.65; color:var(--mist-dim); }
.kl-help a{ color:var(--rose); }
.kl-help h4{ color:#dfe4ee; font-size:13px; margin:18px 0 6px; font-weight:600; }

.kl-tabs{ display:flex; border-top:1px solid var(--line); background:var(--night); }
.kl-tab{ flex:1; background:none; border:0; color:var(--mist-dim); cursor:pointer;
  padding:12px 0 15px; font-family:var(--ui); font-size:11px; font-weight:500; display:flex;
  flex-direction:column; align-items:center; gap:4px; }
.kl-tab.on{ color:var(--rose); }
.kl-tab svg{ width:21px; height:21px; }

.kl-spinner{ width:18px; height:18px; border:2px solid var(--line); border-top-color:var(--rose);
  border-radius:50%; animation:kl-spin .7s linear infinite; }
@keyframes kl-spin{ to{ transform:rotate(360deg); } }

@media (prefers-reduced-motion: reduce){ *{ transition:none !important; animation:none !important; } }
`;

function Icon({ name }) {
  const p = {
    library: "M4 4h5v16H4zM10 4h4v16h-4zM16 6l3-1 2 15-3 1z",
    settings: "M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  }[name];
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={p} />
    </svg>
  );
}

export default function App() {
  const [tab, setTab] = useState("library"); // library | settings
  const [override, setOverride] = useState(""); // optional proxy URL override
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchMsg, setSearchMsg] = useState("");

  const [song, setSong] = useState(null);
  const [songLoading, setSongLoading] = useState(false);
  const [revealed, setRevealed] = useState(() => new Set());
  const [revealAll, setRevealAll] = useState(false);
  const [focus, setFocus] = useState(false);
  const [activeLine, setActiveLine] = useState(null);

  const base = override.trim() || DEFAULT_BASE;

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    setSearchMsg("");
    setLoading(true);
    try {
      const tracks = await mxSearchTracks(base, q);
      setResults(tracks);
      if (tracks.length === 0) setSearchMsg("No songs found. Try a different title or artist.");
    } catch (e) {
      setResults([]);
      setSearchMsg(
        "Couldn't reach the lyrics service. If you're running the deployed app, check that MUSIXMATCH_API_KEY is set on the server. In the preview here there's no backend — open the sample lesson below to try the reader."
      );
    } finally {
      setLoading(false);
    }
  }

  async function openSong(item) {
    setRevealed(new Set());
    setRevealAll(false);
    setActiveLine(null);
    if (item.sample) {
      setSong(item);
      return;
    }
    setSongLoading(true);
    setSong({ ...item, lines: [] });
    try {
      const { lines, partial } = await mxGetLyrics(base, item.id);
      setSong({ ...item, lines, partial });
    } catch (e) {
      setSong({ ...item, lines: [], error: true });
    } finally {
      setSongLoading(false);
    }
  }

  function toggleLine(i) {
    if (focus) setActiveLine(i);
    setRevealed((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  const showEn = (i) => revealAll || revealed.has(i);

  // ---------------- Reader ----------------
  if (song) {
    return (
      <div className="kl-root">
        <style>{CSS}</style>
        <div className="kl-phone">
          <div className="kl-reader-top">
            <button className="kl-back" onClick={() => setSong(null)} aria-label="Back">←</button>
            <div>
              <h2>{song.title}</h2>
              <p>{song.artist}{song.album ? ` · ${song.album}` : ""}</p>
            </div>
          </div>

          <div className="kl-controls">
            <button className={`kl-chip ${revealAll ? "on" : ""}`} onClick={() => setRevealAll((v) => !v)}>
              {revealAll ? "Hide translations" : "Reveal all"}
            </button>
            <button className={`kl-chip ${focus ? "on" : ""}`} onClick={() => { setFocus((v) => !v); setActiveLine(null); }}>
              {focus ? "Focus: on" : "Focus mode"}
            </button>
          </div>

          <div className="kl-body">
            {songLoading && (
              <div className="kl-empty"><div className="kl-spinner" style={{ margin: "0 auto 14px" }} />Loading lyrics…</div>
            )}
            {song.error && (
              <div className="kl-empty">Couldn't load these lyrics.<br />Check your server key, or try another song.</div>
            )}

            {!songLoading && !song.error && (
              <div className="kl-page">
                {song.lines.map((ln, i) => {
                  const on = showEn(i);
                  const dim = focus && activeLine !== null && activeLine !== i;
                  return (
                    <div
                      key={i}
                      className={`kl-line ${on ? "revealed" : ""} ${dim ? "dim" : ""} ${focus && activeLine === i ? "active" : ""}`}
                      onClick={() => toggleLine(i)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), toggleLine(i))}
                    >
                      {!on && <span className="kl-hint">tap</span>}
                      <div className="kl-pl">{ln.pl}</div>
                      <div className={`kl-en ${on ? "show" : ""} ${on && !ln.en ? "blank" : ""}`}>
                        {ln.en || "— translation not available for this line —"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {song.partial && (
              <div className="kl-partial">
                Musixmatch returned a partial lyric (free plans include roughly the first 30%).
                A commercial plan unlocks the full text.
              </div>
            )}
            {song.sample && (
              <div className="kl-partial">
                This is original sample text written for the demo — not a real song. Deploy the app
                with a Musixmatch key to study real lyrics.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------------- Library / Settings ----------------
  return (
    <div className="kl-root">
      <style>{CSS}</style>
      <div className="kl-phone">
        <div className="kl-top">
          <div className="kl-brand">
            <h1>Śpiewnik</h1>
            <span>PL · EN</span>
          </div>
          <p className="kl-sub">Learn Polish, one lyric line at a time.</p>
        </div>

        <div className="kl-body">
          {tab === "library" && (
            <>
              <div className="kl-search-wrap">
                <div className="kl-search">
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && runSearch()}
                    placeholder="Search song or artist…"
                  />
                  <button onClick={runSearch} disabled={loading}>
                    {loading ? <span className="kl-spinner" /> : "Search"}
                  </button>
                </div>
                {searchMsg && <div className="kl-note">{searchMsg}</div>}
              </div>

              {results.length > 0 && (
                <>
                  <div className="kl-sect">Results</div>
                  <div className="kl-list">
                    {results.map((r) => (
                      <button key={r.id} className="kl-card" onClick={() => openSong(r)}>
                        <div className="kl-badge">{(r.title || "?")[0]}</div>
                        <div className="kl-card-txt">
                          <h3>{r.title}</h3>
                          <p>{r.artist}{r.album ? ` · ${r.album}` : ""}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="kl-sect">Try the reader</div>
              <div className="kl-list">
                <button className="kl-card" onClick={() => openSong(SAMPLE)}>
                  <div className="kl-badge">W</div>
                  <div className="kl-card-txt">
                    <h3>{SAMPLE.title}</h3>
                    <p>{SAMPLE.artist} · {SAMPLE.lines.length} lines</p>
                  </div>
                  <span className="kl-tag">SAMPLE</span>
                </button>
              </div>
            </>
          )}

          {tab === "settings" && (
            <div className="kl-set">
              <h2>Settings</h2>
              <label>Proxy URL (optional override)</label>
              <input
                type="url"
                value={override}
                onChange={(e) => setOverride(e.target.value)}
                placeholder={DEFAULT_BASE}
              />
              <div className={`kl-status ${override.trim() ? "ok" : "off"}`}>
                {override.trim()
                  ? "Using your custom proxy URL."
                  : "Using the built-in /api/musixmatch proxy (works once deployed)."}
              </div>

              <div className="kl-help">
                <p>
                  You normally leave this blank. When deployed to Vercel, the app and its lyrics
                  proxy share an address, so <b style={{ color: "var(--rose)" }}>/api/musixmatch</b> just works.
                  Only set an override if you host the proxy somewhere else.
                </p>
                <h4>Set it up once</h4>
                <p>
                  Get a key at <a href="https://developer.musixmatch.com" target="_blank" rel="noreferrer">developer.musixmatch.com</a>,
                  deploy this repo to Vercel, and set <b style={{ color: "var(--rose)" }}>MUSIXMATCH_API_KEY</b> in
                  the project's environment variables. Full steps are in SETUP.md.
                </p>
                <h4>About lyrics</h4>
                <p>
                  Lyrics are copyrighted and never bundled with the app — they're fetched live from
                  the licensed provider. Free plans return ~30% of each lyric; full text needs a paid
                  plan. The sample lesson is original demo text.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="kl-tabs">
          <button className={`kl-tab ${tab === "library" ? "on" : ""}`} onClick={() => setTab("library")}>
            <Icon name="library" /> Library
          </button>
          <button className={`kl-tab ${tab === "settings" ? "on" : ""}`} onClick={() => setTab("settings")}>
            <Icon name="settings" /> Settings
          </button>
        </div>
      </div>
    </div>
  );
}
