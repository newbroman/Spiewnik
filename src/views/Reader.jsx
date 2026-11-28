import React, { useEffect, useLayoutEffect, useState } from "react";
import { PLAYER_KEY, SPLIT_RE, aiCapHit, esc, norm } from "../lib/util.js";
import { apiHeaders } from "../supabase.js";
import { useT } from "../lib/i18nContext.js";

// ---- Reader (side-by-side + player + auto-scroll) ---------------------------
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
  const [immersive, setImmersive] = useState(false);   // hide the English; read in the original (+ pictures)
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
    </>
  );
}
