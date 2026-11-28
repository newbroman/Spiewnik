import React, { useEffect, useMemo, useRef, useState } from "react";
import { SPLIT_RE } from "../lib/util.js";
import { compareWord, makeCloze } from "../lib/practice.js";
import { useT } from "../lib/i18nContext.js";

const seedOf = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// ---- Fill-the-gap practice from the song's own lyrics ------------------------
export default function Cloze({ song }) {
  const t = useT();
  const [round, setRound] = useState(0);
  const items = useMemo(
    () => makeCloze((song.pl || "").split(SPLIT_RE), (song.en || "").split(SPLIT_RE), seedOf(song.id) + round * 7919),
    [song.id, song.pl, song.en, round]
  );
  const [idx, setIdx] = useState(0);
  const [val, setVal] = useState("");
  const [res, setRes] = useState(null);      // null | "exact" | "diacritic" | "wrong" | "shown"
  const [tally, setTally] = useState({ right: 0, tried: 0 });
  const inputRef = useRef(null);
  const it = items[idx];

  useEffect(() => { setIdx(0); setVal(""); setRes(null); setTally({ right: 0, tried: 0 }); }, [song.id, round]);
  useEffect(() => { try { inputRef.current?.focus({ preventScroll: true }); } catch {} }, [idx, round]);

  if (!it) return <div className="prac"><p className="pracnote">{t("clozeNone")}</p></div>;

  const check = (e) => {
    e && e.preventDefault();
    if (res) { next(); return; }
    if (!val.trim()) return;
    const r = compareWord(it.answer, val);
    setRes(r);
    setTally((x) => ({ right: x.right + (r === "exact" ? 1 : r === "diacritic" ? 0.5 : 0), tried: x.tried + 1 }));
  };
  const next = () => { setVal(""); setRes(null); setIdx((i) => Math.min(items.length - 1, i + 1)); };
  const prev = () => { setVal(""); setRes(null); setIdx((i) => Math.max(0, i - 1)); };
  const reveal = () => { if (!res) { setRes("shown"); setTally((x) => ({ ...x, tried: x.tried + 1 })); } };

  const gapCls = "clozegap" + (res ? " " + res : "");
  return (
    <div className="prac cloze">
      <p className="clozepos">{idx + 1} / {items.length} · {t("clozeScore", { n: tally.right, m: tally.tried })}</p>
      <div className="pracline">
        {it.before}
        <span className={gapCls}>{res ? it.answer : "_____"}</span>
        {it.after}
      </div>
      {it.en && <div className="pracen">{it.en}</div>}
      <form className="clozeform" onSubmit={check}>
        <input ref={inputRef} className="clozeinput" value={val} onChange={(e) => setVal(e.target.value)}
          placeholder={t("clozePh")} aria-label={t("clozePh")} autoCapitalize="off" autoCorrect="off" autoComplete="off" spellCheck={false}
          readOnly={!!res} />
        <button className="pracbtn on" type="submit">{res ? t("next") : t("clozeCheck")}</button>
      </form>
      <div className="clozefb" aria-live="polite">
        {res === "exact" && <p className="cfb ok">{t("clozeRight")}</p>}
        {res === "diacritic" && <p className="cfb dia">{t("clozeAccent", { w: it.answer })}</p>}
        {res === "wrong" && <p className="cfb no">{t("clozeWrong", { w: it.answer })}</p>}
        {res === "shown" && <p className="cfb no">{t("clozeWrong", { w: it.answer })}</p>}
      </div>
      {!res && <button className="pracen-toggle" onClick={reveal}>{t("clozeReveal")}</button>}
      <div className="pracnav">
        <button className="navbtn" onClick={prev} disabled={idx === 0}>{t("prev")}</button>
        {idx === items.length - 1 && res
          ? <button className="navbtn" onClick={() => setRound((r) => r + 1)}>{t("clozeAgain")}</button>
          : <button className="navbtn" onClick={next} disabled={idx === items.length - 1}>{t("next")}</button>}
      </div>
    </div>
  );
}
