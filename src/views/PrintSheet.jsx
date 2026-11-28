import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SPLIT_RE } from "../lib/util.js";
import { loadVocab } from "../lib/learning.js";
import { useT } from "../lib/i18nContext.js";

// ---- Print-optimised song sheet ----------------------------------------------
// Rendered into <body> (outside #root) so @media print can hide the app and
// print only this. No PDF dependency: the browser's own Print / Save as PDF.
export default function PrintSheet({ song, targetLang, onClose }) {
  const t = useT();
  const [withVocab, setWithVocab] = useState(false);
  const [vocab, setVocab] = useState([]);
  const pl = (song.pl || "").split(SPLIT_RE);
  const en = (song.en || "").split(SPLIT_RE);
  const n = Math.max(pl.length, en.length);

  useEffect(() => { let ok = true; loadVocab(song.id).then((v) => { if (ok) setVocab(v); }); return () => { ok = false; }; }, [song.id]);
  useEffect(() => {
    document.body.classList.add("printing-song");
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.classList.remove("printing-song"); window.removeEventListener("keydown", onKey); };
  }, []);

  return createPortal(
    <div className="printroot" role="dialog" aria-modal="true" aria-label={t("printSheet")}>
      <div className="printbar noprint">
        <button className="printbtn" onClick={onClose}>← {t("close")}</button>
        {vocab.length > 0 && (
          <label className="printchk">
            <input type="checkbox" checked={withVocab} onChange={(e) => setWithVocab(e.target.checked)} />
            {t("printIncludeVocab", { n: vocab.length })}
          </label>
        )}
        <button className="printbtn go" onClick={() => window.print()}>{t("printNow")}</button>
      </div>
      <article className="printpage">
        <header>
          <h1>{song.title}</h1>
          {song.titleEn && song.titleEn !== song.title && <p className="ptrans">{song.titleEn}</p>}
          <p className="pmeta">{[song.artist, song.album].filter(Boolean).join(" · ")}</p>
        </header>
        <div className="pcols">
          <div className="phead">{song.language}</div>
          <div className="phead">{targetLang || "English"}</div>
          {Array.from({ length: n }).map((_, i) => {
            const p = (pl[i] || "").trim(), e = (en[i] || "").trim();
            if (!p && !e) return <div key={i} className="pgap" />;
            return (
              <React.Fragment key={i}>
                <div className="ppl">{p}</div>
                <div className="pen">{e}</div>
              </React.Fragment>
            );
          })}
        </div>
        {withVocab && vocab.length > 0 && (
          <section className="pvocab">
            <h2>{t("printVocabHead")}</h2>
            <dl>
              {vocab.map((v) => (
                <React.Fragment key={v.id}>
                  <dt>{v.word}{v.lemma && v.lemma !== v.word.toLowerCase() ? ` (${v.lemma})` : ""}{v.pos ? <i> · {v.pos}</i> : null}</dt>
                  <dd>{v.gloss}{v.note ? <span> — {v.note}</span> : null}</dd>
                </React.Fragment>
              ))}
            </dl>
          </section>
        )}
      </article>
    </div>,
    document.body
  );
}
