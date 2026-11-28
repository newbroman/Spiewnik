import React from "react";
import { useT } from "../lib/i18nContext.js";

export default function Help({ onBack, onReplayTour }) {
  const t = useT();
  const items = ["HowItWorks", "Add", "Lyrics", "Translate", "Read", "Immersive", "Play", "Practice", "Copyright", "Downloads"];
  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>{t("help")}</h2><p>{t("helpSub")}</p></div>
      </div>
      <div className="editor">
        {items.map((k, i) => (
          <div className="setcard" key={k} style={{ marginBottom: 12 }}>
            <h3>{i + 1} · {t("help" + k + "H")}</h3>
            <p className="setstate">{t("help" + k + "B")}</p>
          </div>
        ))}
        {onReplayTour && (
          <button className="manuallink" onClick={onReplayTour}>{t("replayTour")}</button>
        )}
      </div>
    </>
  );
}
