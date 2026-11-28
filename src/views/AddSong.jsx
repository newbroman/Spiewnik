import React, { useEffect, useRef, useState } from "react";
import { LANGS, aiCapHit, langOf, songWordOf } from "../lib/util.js";
import { apiHeaders } from "../supabase.js";
import { blobToBase64 } from "../lib/practice.js";
import { useT } from "../lib/i18nContext.js";

// ---- Add a song (search, pick, or add manually) ----------------------------
export default function AddSong({ onBack, onCreate }) {
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
  const [aiQuery, setAiQuery] = useState("");     // the theme behind the current AI results
  const [openai, setOpenai] = useState(false);     // OPENAI key present → voice + AI offered
  const vMediaRef = useRef(null), vStreamRef = useRef(null), vChunksRef = useRef([]);

  // Voice search and AI suggestions both need the OpenAI key; check once.
  useEffect(() => {
    let ok = true;
    fetch("/api/ai", { headers: apiHeaders() }).then((r) => r.json())
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
  // AI suggestions — turn a theme / vague request into a list of real songs.
  // This is the primary "search": it returns real, existing songs that fit.
  async function askAI(queryArg) {
    const query = (typeof queryArg === "string" ? queryArg : q).trim();
    if (aiBusy || !query) return;
    seqRef.current++;                                  // cancel any pending live search
    setAiBusy(true); setSearched(true); setAiQuery(query);
    try {
      const r = await fetch("/api/ai?op=suggest", {
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
        const r = await fetch("/api/ai?op=transcribe", {
          method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
          body: JSON.stringify({ audio: b64, mime: mime || "audio/webm", language: langOf(language).bcp.slice(0, 2) }),
        });
        if (aiCapHit(r, t)) return;
        const j = await r.json();
        const txt = (j.text || "").trim();
        if (txt) { setQ(txt); primarySearch(txt); }    // run the search on the spoken query
      } catch {} finally { setBusy(false); }
    };
    mr.start(); setVoiceRec(true);
    setTimeout(() => { try { if (mr.state !== "inactive") mr.stop(); } catch {} }, 6000); // short query cap
  }

  // The main search action. A pasted Spotify/YouTube link resolves to that exact
  // track; anything else goes to the AI, which returns real songs that fit the
  // request (a title, an artist, or a theme like "Polish nursery rhymes"). The
  // catalogue search is only a fallback for when the AI key isn't configured.
  function primarySearch(queryArg) {
    const query = (typeof queryArg === "string" ? queryArg : q).trim();
    if (!query) return;
    const isLink = /^https?:\/\/\S+$/i.test(query) && /(spotify\.com|youtu\.be|youtube\.com)/i.test(query);
    if (isLink) return runSearch(query);
    if (openai) return askAI(query);
    return runSearch(query);
  }
  async function pick(res) {
    if (creating) return;
    setCreating(true);
    // AI-suggested songs carry no album. Rather than scattering a one-off album
    // per song, group them under the theme you searched (e.g. "Polish nursery
    // rhymes") so they sit together in your library.
    const album = (res.album || "").trim() || (aiMode ? aiQuery.trim() : "");
    await onCreate({ language, artist: res.artist, album, title: res.title });
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
                onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && primarySearch()} />
              {openai && (
                <button className={"micbtn" + (voiceRec ? " on" : "")} onClick={toggleVoice} aria-label={t("voiceSearch")} title={t("voiceSearch")}>
                  {voiceRec ? "⏹" : "🎤"}
                </button>
              )}
              <button className="searchbtn" onClick={() => primarySearch()} disabled={busy || aiBusy || !q.trim()}>
                {busy || aiBusy ? "…" : (openai ? t("aiSearchBtn") : t("search"))}
              </button>
            </div>
            <p className="searchtip">{openai ? t("aiSearchTip") : t("linkTip")}</p>

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
