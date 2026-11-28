import React, { useState } from "react";
import { useT } from "../lib/i18nContext.js";

export default function TourOverlay({ onClose, onAdd }) {
  const t = useT();
  const [i, setI] = useState(0);
  const slides = [
    // Kept to three slides; copy matches what the app actually does.
    { ic: "➕", h: t("tour1H"), b: t("tour1B") },
    { ic: "🔤", h: t("tour2H"), b: t("tour2B") },
    { ic: "🎧", h: t("tour3H"), b: t("tour3B") },
  ];
  const last = i === slides.length - 1;
  const s = slides[i];
  return (
    <div className="tourwrap" role="dialog" aria-modal="true">
      <div className="tourcard">
        <button className="tourskip" onClick={onClose}>{t("tourSkip")}</button>
        <div className="touricon">{s.ic}</div>
        <h2>{s.h}</h2>
        <p>{s.b}</p>
        <div className="tourdots">{slides.map((_, k) => <span key={k} className={k === i ? "on" : ""} />)}</div>
        <div className="tournav">
          {i > 0 && <button className="pracbtn" onClick={() => setI(i - 1)}>{t("prev")}</button>}
          {last
            ? <button className="add" onClick={onAdd}>{t("tourAdd")}</button>
            : <button className="add" onClick={() => setI(i + 1)}>{t("tourNext")}</button>}
        </div>
      </div>
    </div>
  );
}
