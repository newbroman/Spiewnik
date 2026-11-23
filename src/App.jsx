import React, { useEffect, useState } from "react";

// ============================================================================
//  Śpiewnik — side-by-side lyric study (Polish | English)
//
//  Paste a song's Polish lyric and its English line-for-line, and read them
//  side by side. "Auto-translate" fills the English column from the Polish via
//  the /api/translate serverless function (DeepL or Google — your key, your
//  server). Lyrics are supplied by you, for personal study; none are bundled.
//  Song content is kept in this browser (localStorage), not sent anywhere but
//  the translation service you configure.
// ============================================================================

// Her real song titles (public facts). You paste the lyrics yourself.
const SEED = [
  { album: "Tu była (2023)", songs: ["Troja z chemii", "Gorączka", "Houston", "Wróć", "Chinatown", "Gambino", "Dziewczyna z tatuażem", "Falstart albo faul"] },
  { album: "Single", songs: ["Aureola", "Trudno jest być sobą", "Feelings"] },
];
const ARTIST = "Daria ze Śląska";
const KEY = "spiewnik.sidebyside.v1";
const PROVIDER_KEY = "spiewnik.provider.v1";

function seed() {
  const songs = [];
  let n = 0;
  SEED.forEach((g) => g.songs.forEach((t) => songs.push({ id: "s" + n++, title: t, album: g.album, pl: "", en: "" })));
  return songs;
}
function loadSongs() {
  try { const r = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(r?.songs)) return r.songs; } catch {}
  return seed();
}
function saveSongs(songs) { try { localStorage.setItem(KEY, JSON.stringify({ songs })); } catch {} }
const esc = (s) => s || "";

export default function App() {
  const [songs, setSongs] = useState(loadSongs);
  const [view, setView] = useState("list"); // list | reader | edit
  const [curId, setCurId] = useState(null);
  const [provider, setProvider] = useState(() => { try { return localStorage.getItem(PROVIDER_KEY) || "deepl"; } catch { return "deepl"; } });
  const [toast, setToast] = useState("");

  useEffect(() => { saveSongs(songs); }, [songs]);
  useEffect(() => { try { localStorage.setItem(PROVIDER_KEY, provider); } catch {} }, [provider]);

  const cur = songs.find((s) => s.id === curId);
  const flash = (m) => { setToast(m); clearTimeout(flash._t); flash._t = setTimeout(() => setToast(""), 2600); };

  const open = (id) => { setCurId(id); setView("reader"); };
  const edit = (id) => { setCurId(id); setView("edit"); };
  const back = () => setView(view === "edit" ? "reader" : "list");

  function saveSong(patch) {
    setSongs((prev) => prev.map((s) => (s.id === curId ? { ...s, ...patch } : s)));
  }
  function addSong() {
    const id = "s" + Date.now().toString(36);
    setSongs((prev) => [...prev, { id, title: "New song", album: "Single", pl: "", en: "" }]);
    setCurId(id); setView("edit");
  }
  function removeSong(id) {
    setSongs((prev) => prev.filter((s) => s.id !== id));
    setView("list");
    flash("Song removed");
  }

  return (
    <div className="kl-root">
      <style>{CSS}</style>
      <div className="app">
        {view === "list" && <ListView songs={songs} onOpen={open} onAdd={addSong} />}
        {view === "reader" && cur && <Reader song={cur} onBack={() => setView("list")} onEdit={() => edit(cur.id)} />}
        {view === "edit" && cur && (
          <Editor
            song={cur} provider={provider} setProvider={setProvider}
            onBack={back} onSave={(patch) => { saveSong(patch); setView("reader"); flash("Saved on this device"); }}
            onRemove={() => removeSong(cur.id)} flash={flash}
          />
        )}
      </div>
      <div className={"kl-toast" + (toast ? " show" : "")}>{toast}</div>
    </div>
  );
}

function ListView({ songs, onOpen, onAdd }) {
  const albums = [];
  songs.forEach((s) => { let a = albums.find((x) => x.album === s.album); if (!a) { a = { album: s.album, items: [] }; albums.push(a); } a.items.push(s); });
  const done = songs.filter((s) => s.pl && s.pl.trim()).length;
  return (
    <>
      <div className="top">
        <div className="eyebrow">Side-by-side lyrics · study</div>
        <h1>{ARTIST}</h1>
        <p>{done} of {songs.length} songs filled in. Open one to read Polish and English side by side, or to paste and translate its lyrics.</p>
      </div>
      <div className="body">
        {albums.map((a) => (
          <div key={a.album}>
            <div className="albsect">{a.album}</div>
            <div className="songs">
              {a.items.map((s, i) => {
                const filled = !!(s.pl && s.pl.trim());
                return (
                  <button key={s.id} className="song" onClick={() => onOpen(s.id)}>
                    <span className="num">{i + 1}</span>
                    <span className="meta">
                      <h3>{s.title}</h3>
                      <p>{filled ? s.pl.split("\n").filter((l) => l.trim()).length + " lines" : "No lyrics yet — tap to add"}</p>
                    </span>
                    <span className={"dot " + (filled ? "full" : "empty")} />
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="addrow"><button className="add" onClick={onAdd}>+ Add a song</button></div>
      </div>
    </>
  );
}

function Reader({ song, onBack, onEdit }) {
  const pl = (song.pl || "").split("\n");
  const en = (song.en || "").split("\n");
  const n = Math.max(pl.length, en.length);
  const has = song.pl && song.pl.trim();
  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>{song.title}</h2><p>{song.album}</p></div>
        <button className="icbtn accent" onClick={onEdit}>Edit</button>
      </div>
      <div className="sheet">
        <div className="sheethead"><span>Polski</span><span>English</span></div>
        {!has ? (
          <div className="emptysheet">No lyrics here yet.<br />Tap <b>Edit</b> to paste the Polish, then Auto-translate or type the English.</div>
        ) : (
          <div className="grid">
            {Array.from({ length: n }).map((_, i) => {
              const p = (pl[i] || "").trim(), e = (en[i] || "").trim();
              if (!p && !e) return <React.Fragment key={i}><div className="cell gap pl" /><div className="cell gap en" /></React.Fragment>;
              return (
                <React.Fragment key={i}>
                  <div className="cell pl">{esc(p) || " "}</div>
                  <div className="cell en">{esc(e) || " "}</div>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function Editor({ song, provider, setProvider, onBack, onSave, onRemove, flash }) {
  const [title, setTitle] = useState(song.title);
  const [album, setAlbum] = useState(song.album || "");
  const [pl, setPl] = useState(song.pl || "");
  const [en, setEn] = useState(song.en || "");
  const [busy, setBusy] = useState(false);

  async function autoTranslate() {
    const lines = pl.split("\n");
    if (!pl.trim()) { flash("Paste the Polish first"); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/translate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines, source: "PL", target: "EN", provider }),
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

  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>Edit</h2><p>{song.title}</p></div>
      </div>
      <div className="editor">
        <div className="meta2">
          <div><label>Title</label><input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><label>Album <span className="opt">optional</span></label><input value={album} onChange={(e) => setAlbum(e.target.value)} /></div>
        </div>
        <div className="cols">
          <div>
            <label>Polski <span className="opt">paste the whole lyric</span></label>
            <textarea value={pl} onChange={(e) => setPl(e.target.value)} placeholder={"Paste the full Polish lyric here —\nall the lines at once."} />
            <a className="find" href={findUrl(title)} target="_blank" rel="noreferrer">Find Polish lyrics ↗</a>
          </div>
          <div>
            <label>English <span className="opt">auto or type</span></label>
            <textarea className="en" value={en} onChange={(e) => setEn(e.target.value)} placeholder={"Auto-translate, or type the English\nlined up with the Polish."} />
            <div className="trrow">
              <button className="tr" onClick={autoTranslate} disabled={busy}>{busy ? "Translating…" : "⟳ Auto-translate"}</button>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} aria-label="Translation provider">
                <option value="deepl">DeepL</option>
                <option value="google">Google</option>
              </select>
            </div>
          </div>
        </div>
        <p className="hint2">Auto-translate goes line-for-line, so the columns stay aligned. Machine translation is a rough first draft — fix it by hand, which is where the learning is. Needs the translate key set up on your deployment; see SETUP-TRANSLATE.md.</p>
        <div className="actions">
          <button className="save" onClick={() => onSave({ title: title.trim() || song.title, album: album.trim(), pl, en })}>Save</button>
          <button className="cancel" onClick={onBack}>Cancel</button>
        </div>
        <button className="danger" onClick={onRemove}>Remove this song</button>
      </div>
    </>
  );
}

const findUrl = (title) =>
  "https://www.google.com/search?q=" + encodeURIComponent(`${ARTIST} ${title || ""} tekst`);

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
.top{ padding:22px 20px 16px; border-bottom:1px solid var(--line); }
.eyebrow{ font-size:11px; letter-spacing:.2em; text-transform:uppercase; color:var(--rose); font-weight:600; }
.top h1{ font-family:var(--display); font-weight:900; font-size:30px; letter-spacing:-.02em; color:#f3ede1; margin:4px 0 0; line-height:1.02; }
.top p{ margin:7px 0 0; font-size:13px; color:var(--mist-dim); }
.body{ flex:1; padding:6px 16px 60px; }
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
.addrow{ margin-top:10px; } .add{ width:100%; background:none; border:1.5px dashed var(--night-3); color:var(--rose); border-radius:14px; padding:13px; font-family:var(--ui); font-size:14px; cursor:pointer; } .add:hover{ border-color:var(--rose); }
.rbar{ display:flex; align-items:center; gap:10px; padding:16px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--night); z-index:3; }
.icbtn{ background:var(--night-2); border:1px solid var(--line); color:var(--mist); border-radius:10px; height:38px; min-width:38px; padding:0 12px; cursor:pointer; font-size:14px; font-family:var(--ui); line-height:1; }
.icbtn.accent{ background:var(--rose); border-color:var(--rose); color:#20140f; font-weight:600; }
.rbar .ttl{ flex:1; min-width:0; } .rbar .ttl h2{ margin:0; font-family:var(--display); font-weight:900; font-size:19px; color:#f3ede1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; } .rbar .ttl p{ margin:2px 0 0; font-size:12px; color:var(--mist-dim); }
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
.editor .find{ display:inline-block; margin-top:8px; font-size:12px; color:var(--rose); text-decoration:none; } .editor .find:hover{ text-decoration:underline; }
.trrow{ display:flex; gap:8px; margin-top:8px; }
.trrow .tr{ flex:1; background:var(--night-3); border:1px solid var(--line); color:#eef1f6; border-radius:10px; padding:10px; font-family:var(--ui); font-size:13px; font-weight:500; cursor:pointer; }
.trrow .tr:disabled{ opacity:.55; cursor:default; }
.trrow select{ background:var(--night-2); border:1px solid var(--line); color:var(--mist); border-radius:10px; padding:0 10px; font-family:var(--ui); font-size:13px; outline:0; }
.editor .meta2{ display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px; }
.editor input{ width:100%; background:var(--night-2); border:1px solid var(--line); border-radius:11px; padding:11px 13px; color:#eef1f6; font-size:14px; outline:0; font-family:var(--ui); } .editor input:focus{ border-color:var(--rose); }
.editor .hint2{ font-size:12px; color:var(--mist-dim); margin:12px 2px 0; line-height:1.5; }
.editor .actions{ display:flex; gap:10px; margin-top:16px; }
.editor .save{ flex:1; background:var(--rose); color:#20140f; border:0; border-radius:12px; padding:13px; font-weight:600; font-size:15px; font-family:var(--ui); cursor:pointer; }
.editor .cancel{ background:none; border:1px solid var(--line); color:var(--mist-dim); border-radius:12px; padding:13px 18px; font-size:14px; font-family:var(--ui); cursor:pointer; }
.editor .danger{ background:none; border:0; color:var(--mist-dim); font-size:12.5px; cursor:pointer; margin-top:18px; text-decoration:underline; }
.kl-toast{ position:fixed; left:50%; bottom:26px; transform:translateX(-50%) translateY(10px); opacity:0; background:#2c2030; color:#f3e7e4; border:1px solid var(--rose); border-radius:11px; padding:10px 15px; font-size:12.5px; pointer-events:none; transition:opacity .2s, transform .2s; z-index:9; max-width:84%; text-align:center; }
.kl-toast.show{ opacity:1; transform:translateX(-50%) translateY(0); }
@media(max-width:520px){ .cell.pl{ font-size:15px; } .cell.en{ font-size:12.5px; } .editor .cols{ grid-template-columns:1fr; } .editor .meta2{ grid-template-columns:1fr; } .top h1{ font-size:26px; } }
.kl-root :focus-visible{ outline:2px solid var(--rose); outline-offset:2px; }
@media (prefers-reduced-motion: reduce){ .kl-root *{ transition:none !important; } }
`;
