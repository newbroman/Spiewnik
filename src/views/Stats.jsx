import React, { useEffect, useState } from "react";
import { loadStats, useDueCount, useLearningChanges } from "../lib/learning.js";
import { useT } from "../lib/i18nContext.js";

export { useDueCount };

// ---- Stats strip: streak · lines known · due today ---------------------------
// <StatsStrip songs={songs} /> — songs lets stale/removed-song rows be ignored.
export function StatsStrip({ songs }) {
  const t = useT();
  const [s, setS] = useState(null);
  const [tick, setTick] = useState(0);
  useLearningChanges(() => setTick((x) => x + 1));
  const key = (songs || []).map((x) => x.id + ":" + (x.pl || "").length).join(",");
  useEffect(() => {
    let ok = true;
    loadStats(songs).then((r) => { if (ok) setS(r); }).catch(() => {});
    return () => { ok = false; };
  }, [key, tick]);
  if (!s) return null;
  return (
    <div className="statsstrip" role="group" aria-label={t("statsAria")}>
      <div className="stat"><b>{s.streak}</b><span>{t("statStreak")}</span></div>
      <div className="stat"><b>{s.known}</b><span>{t("statKnown")}</span></div>
      <div className="stat"><b>{s.due}</b><span>{t("statDue")}</span></div>
    </div>
  );
}

// ---- Entry points to Review and Vocab ---------------------------------------
export function LearnLinks({ onReview, onVocab, dueCount }) {
  const t = useT();
  return (
    <div className="learnlinks">
      <button className="learnlink" onClick={onReview}>
        <span>{t("review")}</span>
        {dueCount > 0 && <span className="learnbadge" aria-label={t("reviewSub", { n: dueCount })}>{dueCount}</span>}
      </button>
      <button className="learnlink" onClick={onVocab}><span>{t("vocab")}</span></button>
    </div>
  );
}

export default StatsStrip;
