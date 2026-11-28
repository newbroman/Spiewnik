import React, { useEffect, useRef, useState } from "react";
import { LANGS, SPLIT_RE, aiCapHit, langOf, normLines, stripFooter } from "../lib/util.js";
import { apiHeaders } from "../supabase.js";
import { useT } from "../lib/i18nContext.js";

// ---- Editor -----------------------------------------------------------------
export default function Editor({ song, provider, setProvider, hasOwnKey, onSaveKey, targetLang, onBack, onSave, onRemove, flash }) {
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
    fetch("/api/ai", { headers: apiHeaders() }).then((r) => r.json())
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
      const r = await fetch("/api/ai?op=tidy", {
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
      const r = await fetch("/api/ai?op=extract", {
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
    if (!title.trim()) { if (!auto) flash(t("tAddTitleFirst")); return; }
    setFetching(true);
    try {
      // 1. Fast exact lookup in the lyric DB.
      const r = await fetch(`/api/lyrics?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`, { headers: apiHeaders() });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.lyrics && j.lyrics.trim()) {
        applyLyrics(j.lyrics.trim(), !auto);   // an explicit fetch always applies
        if (!auto) flash(t("tLyricsFound"));
        return;
      }
      if (auto) return; // the silent on-open attempt stops at the quick DB

      // 2. Ask the finder: web search + the model's own knowledge. We ALWAYS
      //    try it — the backend handles a missing key — so a not-yet-resolved
      //    aiOk flag (or a blank artist) can never silently skip the finder.
      setFetchStage(t("searchingWeb"));
      const r2 = await fetch("/api/ai?op=findlyrics", {
        method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
        body: JSON.stringify({ artist, title, language }),
      });
      if (aiCapHit(r2, t)) return;
      const j2 = await r2.json().catch(() => ({}));
      if (j2 && j2.text && j2.text.trim()) {
        applyLyrics(j2.text, true);   // the user asked for it — place it even if the box has text
        flash(t("tLyricsFound"));
        return;
      }
      // 3. Still nothing → let the user paste a specific page link.
      setShowLink(true); flash(t("autoFellBack"));
    } catch (e) {
      if (!auto) { setShowLink(true); flash(t("autoFellBack")); }
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
