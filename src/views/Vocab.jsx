import React, { useEffect, useState } from "react";
import { deleteVocab, loadVocab } from "../lib/learning.js";
import { useT } from "../lib/i18nContext.js";

// ---- Saved words, grouped by language ----------------------------------------
export default function Vocab({ songs, onBack, onOpenSong }) {
  const t = useT();
  const [rows, setRows] = useState(null);
  useEffect(() => { let ok = true; loadVocab().then((v) => { if (ok) setRows(v); }); return () => { ok = false; }; }, []);

  const byId = new Map((songs || []).map((s) => [String(s.id), s]));
  const groups = {};
  for (const r of rows || []) (groups[r.language || "—"] ||= []).push(r);
  const langs = Object.keys(groups).sort();

  const del = async (id) => {
    const before = rows;
    setRows((p) => p.filter((r) => r.id !== id));
    if (!(await deleteVocab(id))) setRows(before);
  };

  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label={t("ariaBack")}>←</button>
        <div className="ttl"><h2>{t("vocab")}</h2><p>{rows ? t("vocabCount", { n: rows.length }) : "…"}</p></div>
      </div>
      <div className="body vocabview">
        {rows && rows.length === 0 && <p className="emptylib">{t("vocabEmpty")}</p>}
        {langs.map((lang) => (
          <section key={lang} className="vocabgroup">
            <h3 className="albsect">{lang}</h3>
            <ul className="vocablist">
              {groups[lang].map((v) => {
                const song = v.song_id ? byId.get(v.song_id) : null;
                return (
                  <li key={v.id} className="vocabitem">
                    <div className="vmain">
                      <p className="vword">{v.word}{v.lemma && v.lemma !== (v.word || "").toLowerCase() ? <span className="vlemma"> · {v.lemma}</span> : null}{v.pos ? <span className="vpos"> {v.pos}</span> : null}</p>
                      {v.gloss && <p className="vgloss">{v.gloss}</p>}
                      {v.note && <p className="vnote">{v.note}</p>}
                      {v.line && <p className="vline">“{v.line}”</p>}
                      {song && <button className="vsong" onClick={() => onOpenSong(song.id)}>♪ {song.title}</button>}
                    </div>
                    <button className="songdel" onClick={() => del(v.id)} aria-label={t("vocabDelete", { w: v.word })}>✕</button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
