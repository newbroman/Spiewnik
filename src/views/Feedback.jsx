import React, { useState } from "react";
import { supabase } from "../supabase.js";
import { useT } from "../lib/i18nContext.js";

// Feedback goes to the Google Play listing, where testers can leave private
// feedback that shows up in Play Console (Ratings and reviews > Testing feedback).
// On Android the market:// link opens the Play Store app directly; elsewhere the web listing.
const PLAY_ID = "app.spiewnik.twa";
export function openPlayFeedback() {
  const web = `https://play.google.com/store/apps/details?id=${PLAY_ID}`;
  if (/android/i.test(navigator.userAgent)) {
    window.location.href = `market://details?id=${PLAY_ID}`;
  } else {
    window.open(web, "_blank", "noopener");
  }
}

export default function Feedback({ email, onBack, onSent }) {
  const t = useT();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const send = async () => {
    if (!msg.trim() || busy) return;
    setBusy(true); setErr(false);
    const { error } = await supabase.from("feedback").insert({ message: msg.trim(), email });
    setBusy(false);
    if (error) setErr(true); else onSent();
  };
  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>{t("feedback")}</h2><p>{t("feedbackSub")}</p></div>
      </div>
      <div className="editor">
        <div className="setcard">
          <p className="setstate">{t("feedbackIntro")}</p>
          <textarea className="fbarea" value={msg} rows={6} placeholder={t("feedbackPlaceholder")}
            onChange={(e) => setMsg(e.target.value)} />
          {err && <p className="setstate" style={{ color: "var(--rose)" }}>{t("feedbackErr")}</p>}
          <div className="setbtns">
            <button className="save" onClick={send} disabled={busy || !msg.trim()}>{busy ? t("saving") : t("feedbackSend")}</button>
          </div>
        </div>
      </div>
    </>
  );
}
