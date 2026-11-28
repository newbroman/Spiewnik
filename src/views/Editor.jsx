import React, { useEffect, useRef, useState } from "react";
import { LANGS, SPLIT_RE, aiCapHit, hostOf, langOf, lyricsWordOf, normLines, stripFooter } from "../lib/util.js";
import { clearDraft, getDraft, getLyricSource, setDraft, setLyricSource } from "../lib/local.js";
import { translateLines } from "../lib/translate.js";
import { apiHeaders } from "../supabase.js";
import { useT } from "../lib/i18nContext.js";

const FIELDS = ["title", "artist", "album", "titleEn", "albumEn", "language", "pl", "en"];
const fromSong = (s) => ({
  title: s.title || "", artist: s.artist || "", album: s.album || "", titleEn: s.titleEn || "",
  albumEn: s.albumEn || "", language: s.language || "Polish", pl: s.pl || "", en: s.en || "",
});

// Provenance from a lyrics response: { kind: "lookup" | "web" | "link" | "paste", url? }.
// Handles the current server shape (source + url) and the older one (source = url).
function srcFrom(j, fallback) {
  const s = j && j.source;
  if (s === "lookup") return { kind: "lookup" };
  if (s === "web") return j.url ? { kind: "web", url: j.url } : { kind: "web" };
  if (s === "link") return { kind: "link", url: (j && j.url) || (fallback && fallback.url) };
  if (typeof s === "string" && /^https?:\/\//i.test(s)) return { kind: "web", url: s };
  return fallback || null;
}

// ---- Editor -----------------------------------------------------------------
// registerGuard(fn): the App calls fn() before leaving this view (Back button,
// system Back, Cancel). fn returns false to stay. isNew marks a song created in
// this session; onAbandon deletes it when left with no title and no lyrics.
export default function Editor({ song, provider, setProvider, hasOwnKey, onSaveKey, targetLang, onBack, onSave, onRemove, flash, onUsage, registerGuard, isNew, onAbandon }) {
  const t = useT();
  // Restore an autosaved draft (per song id) if it differs from what's stored.
  const [init] = useState(() => {
    const base = fromSong(song);
    const d = getDraft(song.id);
    if (d && FIELDS.some((k) => typeof d[k] === "string" && d[k] !== base[k])) {
      const v = { ...base };
      FIELDS.forEach((k) => { if (typeof d[k] === "string") v[k] = d[k]; });
      return { v, src: d.src || getLyricSource(song.id), restored: true };
    }
    return { v: base, src: getLyricSource(song.id), restored: false };
  });
  const [title, setTitle] = useState(init.v.title);
  const [artist, setArtist] = useState(init.v.artist);
  const [album, setAlbum] = useState(init.v.album);
  const [titleEn, setTitleEn] = useState(init.v.titleEn);
  const [albumEn, setAlbumEn] = useState(init.v.albumEn);
  const [language, setLanguage] = useState(init.v.language);
  const [pl, setPl] = useState(init.v.pl);
  const [en, setEn] = useState(init.v.en);
  const [src, setSrc] = useState(init.src);           // where the lyric came from
  const [restored, setRestored] = useState(init.restored);
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
  const savedRef = useRef(false);
  // When auto-find comes up empty, point the user at the link field.
  useEffect(() => { if (showLink && linkRef.current) { try { linkRef.current.focus(); } catch {} } }, [showLink]);

  useEffect(() => {
    let ok = true;
    fetch("/api/ai", { headers: apiHeaders() }).then((r) => r.json())
      .then((j) => { if (ok) setAiOk(!!(j && j.configured)); }).catch(() => {});
    return () => { ok = false; };
  }, []);

  // ---- Unsaved-change tracking, autosaved drafts and the leave guard --------
  const cur = { title, artist, album, titleEn, albumEn, language, pl, en };
  const base = fromSong(song);
  const dirty = FIELDS.some((k) => cur[k] !== base[k]);
  const latest = useRef({});
  latest.current = { cur, dirty, src };

  useEffect(() => {
    if (savedRef.current) return;
    const h = setTimeout(() => {
      if (savedRef.current) return;
      if (dirty) setDraft(song.id, { ...cur, src, at: Date.now() });
      else clearDraft(song.id);
    }, 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line
  }, [title, artist, album, titleEn, albumEn, language, pl, en, src]);

  useEffect(() => {
    if (!registerGuard) return;
    const guard = () => {
      if (savedRef.current) return true;
      const { cur: c, dirty: d } = latest.current;
      if (d) {
        if (!window.confirm(t("unsavedConfirm"))) return false;
        clearDraft(song.id);
      }
      savedRef.current = true;
      // A brand-new song left with no title and no lyrics is just clutter.
      if (isNew && !c.title.trim() && !c.pl.trim() && !(song.pl || "").trim() && onAbandon) onAbandon(song.id);
      return true;
    };
    registerGuard(guard);
    return () => registerGuard(null, guard);
    // eslint-disable-next-line
  }, [song.id]);

  const discardDraft = () => {
    const b = fromSong(song);
    setTitle(b.title); setArtist(b.artist); setAlbum(b.album); setTitleEn(b.titleEn); setAlbumEn(b.albumEn);
    setLanguage(b.language); setPl(b.pl); setEn(b.en); setSrc(getLyricSource(song.id));
    clearDraft(song.id); setRestored(false);
  };

  // Typing into an empty box counts as pasting; clearing it forgets the source.
  const onLyricsChange = (v) => {
    const next = normLines(v);
    setPl(next);
    if (!next.trim()) setSrc(null);
    else if (!pl.trim() && !src) setSrc({ kind: "paste" });
  };

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
    setSrc({ kind: "paste" });
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
  const applyLyrics = (text, force, source) => {
    if (!force && pl && pl.trim()) return false;   // never clobber lyrics you typed
    const clean = normLines(text);
    setPl(clean);
    setSrc(source || null);
    if (hasOwnKey && !en.trim()) autoTranslate(clean);
    return true;
  };
  const foundToast = (s) => {
    const site = s && s.url ? hostOf(s.url) : "";
    flash(site ? t("tLyricsFoundOn", { site }) : t("tLyricsFoundCheck"));
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
      if (j && typeof j.text === "string" && j.text.trim()) {
        const s = srcFrom(j, { kind: "link", url });
        applyLyrics(j.text, true, s); setShowLink(false); setLinkUrl(""); foundToast(s);
      }
      else flash(t("extractFailed"));
    } catch { flash(t("extractFailed")); } finally { setExtractBusy(false); }
  }

  // Try to pull the original lyric automatically: the lyrics DB first, then the
  // web finder. `auto` = the silent attempt on open (DB only).
  async function fetchLyrics(auto) {
    if (!title.trim()) { if (!auto) flash(t("tAddTitleFirst")); return; }
    setFetching(true);
    // Progress copy for the long find, driven by elapsed time (and never moving
    // backwards past the phase we're actually in).
    const started = Date.now();
    let phase = 0;
    const stages = [t("stageDb"), t("stageWeb"), t("stagePages")];
    const tick = () => {
      const el = Date.now() - started;
      const byTime = el < 2500 ? 0 : el < 9000 ? 1 : 2;
      setFetchStage(stages[Math.max(phase, byTime)]);
    };
    tick();
    const timer = auto ? null : setInterval(tick, 500);
    try {
      // 1. Fast exact lookup in the lyric DB.
      const r = await fetch(`/api/lyrics?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`, { headers: apiHeaders() });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.lyrics && j.lyrics.trim()) {
        const s = srcFrom(j, { kind: "lookup" });
        if (applyLyrics(j.lyrics.trim(), !auto, s) || !auto) foundToast(s);
        return;
      }
      if (auto) return; // the silent on-open attempt stops at the quick DB

      // 2. The web finder (search + read the best pages).
      phase = 1; tick();
      const r2 = await fetch("/api/ai?op=findlyrics", {
        method: "POST", headers: { "Content-Type": "application/json", ...apiHeaders() },
        body: JSON.stringify({ artist, title, language }),
      });
      if (aiCapHit(r2, t)) return;
      const j2 = await r2.json().catch(() => ({}));
      if (j2 && j2.text && j2.text.trim()) {
        const s = srcFrom(j2, null);
        applyLyrics(j2.text, true, s);   // the user asked for it — place it even if the box has text
        foundToast(s);
        return;
      }
      // 3. Still nothing → let the user paste a specific page link (or the words).
      setShowLink(true); flash(t("autoFellBack"));
    } catch (e) {
      if (!auto) { setShowLink(true); flash(t("autoFellBack")); }
    } finally {
      if (timer) clearInterval(timer);
      setFetching(false); setFetchStage("");
    }
  }
  // On opening a song that has no lyrics yet, have a go automatically.
  useEffect(() => { if (!(song.pl || "").trim() && !init.v.pl.trim()) fetchLyrics(true); /* eslint-disable-next-line */ }, []);

  async function autoTranslate(srcArg) {
    const text = typeof srcArg === "string" ? srcArg : pl;
    if (!text.trim()) { flash(t("tPasteFirst")); return; }
    const lyrics = text.split(SPLIT_RE);
    const source = langOf(language).code, target = langOf(targetLang || "English").code;
    setBusy(true);
    try {
      // Lyrics in ≤7500-char / ≤350-line batches (server caps a request).
      const res = await translateLines({ lines: lyrics, source, target, provider });
      setEn(res.translations.join("\n"));
      if (res.usage && onUsage) onUsage(res.usage);
      // Title + album ride the cheap kind:"title" path (no trial use).
      const meta = [title.trim(), album.trim()];
      if (meta.some(Boolean)) {
        try {
          const m = await translateLines({ lines: meta, source, target, provider, kind: "title" });
          setTitleEn((m.translations[0] || "").trim());
          setAlbumEn((m.translations[1] || "").trim());
        } catch { /* the lyric translation still stands */ }
      }
      const u = res.usage;
      if (u && !u.ownKey && typeof u.limit === "number") {
        const songs = Math.floor(Math.max(0, u.limit - (u.used || 0)) / 1500);
        flash(songs > 0 ? t("tTrLeftSongs", { songs }) : t("tTrLast"));
      } else if (!u && res.usedOwnKey === false && typeof res.trialRemaining === "number") {
        flash(res.trialRemaining > 0 ? t("tTrLeft", { n: res.trialRemaining }) : t("tTrLast"));
      } else flash(t("tTranslated"));
    } catch (e) {
      if (e && e.status === 402) { setTrialOut(true); if (e.usage && onUsage) onUsage(e.usage); }
      else if (e && e.status === 413) flash(t("tTooLong"));
      else flash(t("tCouldntTranslate", { msg: (e && e.message) || "" }));
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

  const save = () => {
    savedRef.current = true;
    clearDraft(song.id);
    setLyricSource(song.id, pl.trim() ? src : null);
    onSave({ title: title.trim() || song.title, artist: artist.trim(), album: album.trim(), titleEn: titleEn.trim(), albumEn: albumEn.trim(), language, pl, en });
  };
  const remove = () => {
    savedRef.current = true;
    clearDraft(song.id); setLyricSource(song.id, null);
    onRemove();
  };

  const findUrl = "https://www.google.com/search?q=" + encodeURIComponent(`${artist} ${title || ""} ${lyricsWordOf(language)}`.replace(/\s+/g, " ").trim());
  const srcHost = src && src.url ? hostOf(src.url) : "";

  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label={t("back")}>←</button>
        <div className="ttl"><h2>{t("edit")}</h2><p>{song.title}</p></div>
      </div>
      <div className="editor">
        {restored && (
          <div className="draftnote">
            <span>{t("draftRestored")}</span>
            <button type="button" onClick={discardDraft}>{t("draftDiscard")}</button>
          </div>
        )}
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
            <textarea value={pl} onChange={(e) => onLyricsChange(e.target.value)} onPaste={onPasteLyrics} placeholder={fetching ? (fetchStage || t("fetching")) : t(aiOk ? "lyricBoxPh" : "lyricBoxPhPlain")} />
            {pl.trim() && src && (src.kind !== "web" || srcHost) && (
              <p className="lyrprov">
                {src.kind === "lookup" && t("srcLookup")}
                {src.kind === "web" && srcHost && (() => {
                  const [pre, post = ""] = t("srcWeb").split("{site}");
                  return <>{pre}<a href={src.url} target="_blank" rel="noreferrer">{srcHost}</a>{post}</>;
                })()}
                {src.kind === "link" && (src.url
                  ? <a href={src.url} target="_blank" rel="noreferrer">{t("srcLink")}</a>
                  : t("srcLink"))}
                {src.kind === "paste" && t("srcPaste")}
              </p>
            )}
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
                  <a href={findUrl} target="_blank" rel="noreferrer">{t("lyrWebSearch")}<span aria-hidden="true"> ↗</span></a>
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
              <select value={provider} onChange={(e) => setProvider(e.target.value)} aria-label={t("providerLabel")}>
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
            <p>{t("deeplWhat")}</p>
            <p className="keycard">{t("deeplCard")}</p>
            <a className="findbtn" href="https://www.deepl.com/pro-api" target="_blank" rel="noreferrer">{t("getKeyFree")}</a>
            <div className="upsellrow">
              <div className="pwfield" style={{ flex: 1 }}>
                <input type={showKeyInput ? "text" : "password"} value={keyInput} placeholder={t("pasteKey")} onChange={(e) => setKeyInput(e.target.value)}
                  autoCapitalize="off" autoCorrect="off" spellCheck={false} />
                <button type="button" className="pweye" onClick={() => setShowKeyInput((v) => !v)} aria-label={showKeyInput ? t("hide") : t("show")}>{showKeyInput ? t("hide") : t("show")}</button>
              </div>
              <button className="tr" onClick={saveKeyAndRetry} disabled={savingKey || !keyInput.trim()}>{savingKey ? "…" : t("saveTranslate")}</button>
            </div>
          </div>
        )}
        <p className="hint2">{t("translateHint")}</p>
        <div className="actions">
          <button className="save" onClick={save}>{t("save")}</button>
          <button className="cancel" onClick={onBack}>{t("cancel")}</button>
        </div>
        <button className="danger" onClick={remove}>{t("removeSong")}</button>
      </div>
    </>
  );
}
