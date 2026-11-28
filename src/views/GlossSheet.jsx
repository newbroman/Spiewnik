import React, { useEffect, useRef, useState } from "react";
import { aiCapHit } from "../lib/util.js";
import { fetchGloss, saveVocab } from "../lib/learning.js";
import { flashGlobal } from "../lib/toast.js";
import { useT } from "../lib/i18nContext.js";

// ---- Word gloss bottom sheet (Study mode, press-and-hold a word) ------------
export default function GlossSheet({ song, word, line, targetLang, onClose }) {
  const t = useT();
  const [st, setSt] = useState({ phase: "loading" }); // loading | ok | error | cap
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef(null);

  const run = async () => {
    setSt({ phase: "loading" });
    const r = await fetchGloss({ word, line, language: song.language, target: targetLang || "English" }, aiCapHit, t);
    if (r.ok) setSt({ phase: "ok", ...r });
    else setSt({ phase: r.reason === "cap" ? "cap" : "error" });
  };
  useEffect(() => { setSaved(false); run(); }, [word, line]);
  useEffect(() => {
    try { closeRef.current?.focus(); } catch {}
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const save = async () => {
    if (st.phase !== "ok" || busy) return;
    setBusy(true);
    const res = await saveVocab({ word, lemma: st.lemma, gloss: st.gloss, note: st.note, pos: st.pos, song, line });
    setBusy(false);
    if (res === "saved") { setSaved(true); flashGlobal(t("vocabSaved")); }
    else if (res === "exists") { setSaved(true); flashGlobal(t("vocabExists")); }
    else flashGlobal(t("vocabSaveFailed"));
  };

  return (
    <div className="glosswrap" onClick={onClose}>
      <div className="glosssheet" role="dialog" aria-modal="true" aria-labelledby="glossword" onClick={(e) => e.stopPropagation()}>
        <div className="glosshead">
          <h3 id="glossword">{word}</h3>
          <button ref={closeRef} className="glossx" onClick={onClose} aria-label={t("close")}>✕</button>
        </div>
        {st.phase === "loading" && <p className="glossmsg" aria-live="polite">{t("glossLoading")}</p>}
        {(st.phase === "error" || st.phase === "cap") && (
          <div className="glossmsg" aria-live="polite">
            <p>{st.phase === "cap" ? t("aiLimit") : t("glossError")}</p>
            {st.phase === "error" && <button className="glossbtn quiet" onClick={run}>{t("glossRetry")}</button>}
          </div>
        )}
        {st.phase === "ok" && (
          <>
            <div className="glossbody">
              {st.lemma && st.lemma.toLowerCase() !== word.toLowerCase() && <p className="glosslemma">{st.lemma}</p>}
              {st.pos && <p className="glosspos">{st.pos}</p>}
              <p className="glossgloss">{st.gloss}</p>
              {st.note && <p className="glossnote">{st.note}</p>}
              <p className="glossline">“{line}”</p>
            </div>
            <button className="glossbtn" onClick={save} disabled={busy || saved}>
              {saved ? "✓ " + t("vocabSavedShort") : t("saveVocab")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
