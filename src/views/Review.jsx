import React, { useEffect, useState } from "react";
import { gradeLine, loadDue, songTrans } from "../lib/learning.js";
import { sortQueue } from "../lib/srs.js";
import { useT } from "../lib/i18nContext.js";

// ---- Daily review queue across all songs ------------------------------------
export default function Review({ songs, onBack, onOpenSong }) {
  const t = useT();
  const [queue, setQueue] = useState(null); // null = loading
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  useEffect(() => {
    let ok = true;
    loadDue(songs).then((rows) => { if (ok) setQueue(sortQueue(rows)); }).catch(() => { if (ok) setQueue([]); });
    return () => { ok = false; };
  }, []);

  const cur = queue && queue[0];
  const grade = async (g) => {
    if (!cur || busy) return;
    setBusy(true);
    const row = await gradeLine(cur.song, cur.line_idx, g, cur);
    setBusy(false);
    setShown(false);
    setDone((d) => d + 1);
    // "Again" comes back round at the end of this session.
    setQueue((q) => { const rest = q.slice(1); return g === "again" ? [...rest, { ...cur, ...(row || {}), song: cur.song }] : rest; });
  };

  const onKey = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShown((v) => !v); } };

  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label={t("ariaBack")}>←</button>
        <div className="ttl">
          <h2>{t("review")}</h2>
          <p aria-live="polite">{queue ? t("reviewSub", { n: queue.length }) : "…"}</p>
        </div>
      </div>
      <div className="prac review">
        {queue === null ? null : !cur ? (
          <p className="pracnote">{done ? t("reviewDone") : t("reviewNone")}</p>
        ) : (
          <>
            <p className="revsrc">
              {cur.song.title}{cur.song.artist ? " · " + cur.song.artist : ""}
              {cur.state === "shaky" && <span className="revtag">{t("lineShaky")}</span>}
            </p>
            <div className="revcard" role="button" tabIndex={0} aria-expanded={shown}
              onClick={() => setShown((v) => !v)} onKeyDown={onKey}>
              <div className="pracline">{(cur.line_text || "").trim()}</div>
              {shown ? <div className="pracen">{songTrans(cur.song, cur.line_idx) || "—"}</div>
                : <div className="revtap">{t("tapToReveal")}</div>}
            </div>
            <div className="pracbtns revgrades" role="group" aria-label={t("lineStateAria")}>
              <button className="pracbtn again" onClick={() => grade("again")} disabled={busy}>{t("lineAgain")}</button>
              <button className="pracbtn shaky" onClick={() => grade("shaky")} disabled={busy}>{t("lineShaky")}</button>
              <button className="pracbtn known" onClick={() => grade("known")} disabled={busy}>{t("lineKnown")}</button>
            </div>
            <button className="pracen-toggle" onClick={() => onOpenSong(cur.song.id)}>{t("openSong")} →</button>
          </>
        )}
      </div>
    </>
  );
}
