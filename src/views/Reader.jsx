import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PLAYER_KEY, SPLIT_RE, aiCapHit, esc, norm } from "../lib/util.js";
import { apiHeaders } from "../supabase.js";
import { useT } from "../lib/i18nContext.js";
import { clearLine, gradeLine, loadSongProgress } from "../lib/learning.js";
import GlossSheet from "./GlossSheet.jsx";
import PrintSheet from "./PrintSheet.jsx";

const MODE_KEY = "spiewnik.readmode.v1";          // study | side | immersive
const PLAYER_COLLAPSED_KEY = "spiewnik.playercollapsed.v1";
const GLOSS_HINT_KEY = "spiewnik.glosshint.v1";
const WORD_SPLIT = /([\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*)/u;
const lsGet = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

// ---- Reader (study / side-by-side / immersive + player + auto-scroll) -------
export default function Reader({ song, targetLang, onBack, onEdit, onPractice, onFoundMedia }) {
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
  // Reading mode, remembered. "immersive" is the old Immersive toggle, unchanged.
  const [mode, setModeRaw] = useState(() => { const m = lsGet(MODE_KEY, "study"); return ["study", "side", "immersive"].includes(m) ? m : "study"; });
  const setMode = (m) => { setModeRaw(m); lsSet(MODE_KEY, m); };
  const immersive = mode === "immersive";              // hide the English; read in the original (+ pictures)
  const study = mode === "study";
  const [collapsed, setCollapsed] = useState(() => lsGet(PLAYER_COLLAPSED_KEY, "0") === "1");
  const toggleCollapsed = () => setCollapsed((v) => { lsSet(PLAYER_COLLAPSED_KEY, v ? "0" : "1"); return !v; });
  const [revealed, setRevealed] = useState(() => new Set());
  const [progress, setProgress] = useState({});        // line idx → line_progress row (stale rows dropped)
  const [gloss, setGloss] = useState(null);            // { word, line } while the sheet is open
  const [printing, setPrinting] = useState(false);
  const [glossHint, setGlossHint] = useState(() => lsGet(GLOSS_HINT_KEY, "") !== "1");
  const dismissHint = () => { setGlossHint(false); lsSet(GLOSS_HINT_KEY, "1"); };

  useEffect(() => {
    let ok = true;
    setRevealed(new Set()); setProgress({}); setGloss(null);
    if (!song.demo) loadSongProgress(song).then((p) => { if (ok) setProgress(p); }).catch(() => {});
    return () => { ok = false; };
  }, [song.id, song.pl]);

  const lineIdxs = Array.from({ length: n }, (_, i) => i).filter((i) => (pl[i] || "").trim());
  const allRevealed = lineIdxs.length > 0 && lineIdxs.every((i) => revealed.has(i));
  const toggleLine = (i) => setRevealed((prev) => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s; });
  const toggleAll = () => setRevealed(allRevealed ? new Set() : new Set(lineIdxs));

  const mark = async (i, state) => {
    const prev = progress[i];
    if (prev && prev.state === state) {                // tap the active state again to clear it
      setProgress((p) => { const q = { ...p }; delete q[i]; return q; });
      if (!(await clearLine(song, i))) setProgress((p) => ({ ...p, [i]: prev }));
      return;
    }
    setProgress((p) => ({ ...p, [i]: { ...(prev || {}), state } }));   // optimistic
    const row = await gradeLine(song, i, state, prev);
    setProgress((p) => { const q = { ...p }; if (row) q[i] = row; else if (prev) q[i] = prev; else delete q[i]; return q; });
  };

  // Press-and-hold a word (Study mode) → gloss sheet. A hold suppresses the tap.
  const lp = useRef({ timer: 0, fired: false, x: 0, y: 0 });
  const holdStart = (e, line) => {
    const el = e.target.closest && e.target.closest("[data-w]");
    lp.current.fired = false;
    clearTimeout(lp.current.timer);
    if (!el || song.demo) return;
    lp.current.x = e.clientX; lp.current.y = e.clientY;
    lp.current.timer = setTimeout(() => {
      lp.current.fired = true;
      try { navigator.vibrate && navigator.vibrate(12); } catch {}
      dismissHint();
      setGloss({ word: el.getAttribute("data-w"), line });
    }, 480);
  };
  const holdMove = (e) => {
    if (Math.abs(e.clientX - lp.current.x) > 10 || Math.abs(e.clientY - lp.current.y) > 10) clearTimeout(lp.current.timer);
  };
  const holdEnd = () => clearTimeout(lp.current.timer);
  const onLineClick = (i) => {
    if (lp.current.fired) { lp.current.fired = false; return; }
    toggleLine(i);
  };
  const onLineKey = (e, i) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleLine(i); }
  };
  const [emoji, setEmoji] = useState(null);            // emoji per line, or null when off
  const [emojiBusy, setEmojiBusy] = useState(false);
  const [illustOk, setIllustOk] = useState(false);     // OpenAI key present → emoji anchors offered

  useEffect(() => {
    let ok = true;
    fetch("/api/ai", { headers: apiHeaders() }).then((r) => r.json())
      .then((j) => { if (ok) setIllustOk(!!(j && j.configured)); }).catch(() => {});
    return () => { ok = false; };
  }, []);

  const illustrate = async () => {
    if (emojiBusy) return;
    if (emoji) { setEmoji(null); return; }              // toggle the anchors off
    setEmojiBusy(true);
    try {
      const r = await fetch("/api/ai?op=illustrate", {
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
          <button className="icbtn" onClick={onBack} aria-label={t("ariaBack")}>←</button>
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
          <div className={"playerbox" + (collapsed ? " collapsed" : "")}>
            <div className="plcontrols">
              <button className="plcollapse" onClick={toggleCollapsed} aria-expanded={!collapsed}
                aria-label={collapsed ? t("playerExpand") : t("playerCollapse")} title={collapsed ? t("playerExpand") : t("playerCollapse")}>
                {collapsed ? "▾" : "▴"}
              </button>
              {avail.length > 1 ? (
                <div className="srctoggle">
                  <button className={eff === "youtube" ? "on" : ""} onClick={() => pick("youtube")}>YouTube</button>
                  <button className={eff === "spotify" ? "on" : ""} onClick={() => pick("spotify")}>Spotify</button>
                </div>
              ) : <span />}
              <div className="ascroll">
                {autoScroll && (
                  <>
                    <button className="asstep" aria-label={t("ariaSlower")} onClick={() => setScrollSpeed((s) => Math.max(2, s - 3))}>−</button>
                    <button className="asstep" aria-label={t("ariaFaster")} onClick={() => setScrollSpeed((s) => Math.min(44, s + 3))}>+</button>
                  </>
                )}
                <button className={"autoscroll" + (autoScroll ? " on" : "")} onClick={() => setAutoScroll((v) => !v)} aria-pressed={autoScroll}>
                  {autoScroll ? t("autoScroll") + " ●" : t("autoScroll")}
                </button>
              </div>
            </div>
            <div className="plframe" aria-hidden={collapsed || undefined}>
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
          </div>
        )}
      </div>
      <div className="sheet">
        {has && (
          <div className="sheettools" role="toolbar" aria-label={t("readerTools")}>
            <div className="modeseg" role="group" aria-label={t("readMode")}>
              <button className={"stool" + (study ? " on" : "")} aria-pressed={study} onClick={() => setMode("study")}>{t("modeStudy")}</button>
              <button className={"stool" + (mode === "side" ? " on" : "")} aria-pressed={mode === "side"} onClick={() => setMode("side")}>{t("modeSide")}</button>
              <button className={"stool" + (immersive ? " on" : "")} aria-pressed={immersive} onClick={() => setMode(immersive ? "side" : "immersive")}>{t("immersive")}</button>
            </div>
            {study && (
              <button className="stool" onClick={toggleAll} aria-pressed={allRevealed}>{allRevealed ? t("hideAll") : t("revealAll")}</button>
            )}
            <button className="stool" onClick={() => setPrinting(true)} aria-label={t("printSheetAria")}>⎙ {t("printSheet")}</button>
            {illustOk && !song.demo && (
              <button className={"stool" + (emoji ? " on" : "")} onClick={illustrate} disabled={emojiBusy}>
                {emojiBusy ? "…" : t("illustrate")}
              </button>
            )}
          </div>
        )}
        {!has ? (
          <div className="emptysheet">{t("noLyricsHere")}<br />{t("tapEditToPaste")}</div>
        ) : study ? (
          <>
            {glossHint && !song.demo && (
              <div className="glosshint" role="note">
                <span>{t("glossHint")}</span>
                <button onClick={dismissHint}>{t("gotIt")}</button>
              </div>
            )}
            <div className="study">
              {Array.from({ length: n }).map((_, i) => {
                const p = (pl[i] || "").trim(), e = (en[i] || "").trim();
                const em = emoji && emoji[i] ? emoji[i] : "";
                if (!p) return e ? <div key={i} className="sline orphan"><span className="sen">{e}</span></div> : <div key={i} className="sgap" />;
                const open = revealed.has(i);
                const st = progress[i] && progress[i].state;
                return (
                  <div key={i} className={"sline" + (open ? " open" : "") + (st ? " st-" + st : "")}>
                    <div className="slinebtn" role="button" tabIndex={0} aria-expanded={open}
                      onClick={() => onLineClick(i)} onKeyDown={(ev) => onLineKey(ev, i)}
                      onPointerDown={(ev) => holdStart(ev, p)} onPointerMove={holdMove}
                      onPointerUp={holdEnd} onPointerCancel={holdEnd} onPointerLeave={holdEnd}
                      onContextMenu={(ev) => { if (ev.target.closest && ev.target.closest("[data-w]")) ev.preventDefault(); }}>
                      <span className="spl">
                        {p.split(WORD_SPLIT).map((part, k) => (k % 2 ? <span key={k} className="sw" data-w={part}>{part}</span> : part))}
                        {st && <span className={"sbadge " + st} title={t(st === "known" ? "lineKnown" : "lineShaky")}><span className="vh">{t(st === "known" ? "lineKnown" : "lineShaky")}</span></span>}
                      </span>
                      {open && <span className="sen">{em ? <span className="cememoji">{em} </span> : null}{e || "—"}</span>}
                    </div>
                    {open && !song.demo && (
                      <div className="lstate" role="group" aria-label={t("lineStateAria")}>
                        <button className={"lsbtn known" + (st === "known" ? " on" : "")} aria-pressed={st === "known"} onClick={() => mark(i, "known")}>✓ {t("lineKnown")}</button>
                        <button className={"lsbtn shaky" + (st === "shaky" ? " on" : "")} aria-pressed={st === "shaky"} onClick={() => mark(i, "shaky")}>~ {t("lineShaky")}</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="immhint">{t("studyHint")}</p>
          </>
        ) : (
          <>
            <div className={"sheethead" + (immersive && !emoji ? " solo" : "")}>
              <span>{song.language}</span>
              {!(immersive && !emoji) && <span>{immersive ? t("picturesCol") : (targetLang || "English")}</span>}
            </div>
            <div className={"grid" + (immersive && !emoji ? " solo" : "")}>
              {Array.from({ length: n }).map((_, i) => {
                const p = (pl[i] || "").trim(), e = (en[i] || "").trim();
                const em = emoji && emoji[i] ? emoji[i] : "";
                if (!p && !e) return <React.Fragment key={i}><div className="cell gap pl" /><div className="cell gap en" /></React.Fragment>;
                return (
                  <React.Fragment key={i}>
                    <div className="cell pl">{esc(p) || " "}</div>
                    <div className="cell en">{em ? <span className="cememoji">{em} </span> : null}{!immersive && e ? esc(e) : null}{!em && (immersive || !e) ? " " : null}</div>
                  </React.Fragment>
                );
              })}
            </div>
            {immersive && <p className="immhint">{t("immHint")}</p>}
          </>
        )}
      </div>
      {gloss && <GlossSheet song={song} word={gloss.word} line={gloss.line} targetLang={targetLang} onClose={() => setGloss(null)} />}
      {printing && <PrintSheet song={song} targetLang={targetLang} onClose={() => setPrinting(false)} />}
    </>
  );
}
