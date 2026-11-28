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
        <button className="icbtn" onClick={onBack} aria-label={t("back")}>←</button>
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

// ---- Chooser opened from the library menu: in-app note or Play review --------
// In the Play Store app (TWA) the Play review is the natural route, so it comes
// first and is highlighted there; on the web the in-app form leads.
export function FeedbackChooser({ preferPlay, onInApp, onPlay, onClose }) {
  const t = useT();
  const inApp = (
    <button key="app" className={"chooseopt" + (preferPlay ? "" : " primary")} onClick={onInApp}>
      <span className="chooseic" aria-hidden="true">✉️</span>
      <span className="choosetx"><b>{t("fbInApp")}</b><small>{t("fbInAppSub")}</small></span>
    </button>
  );
  const play = (
    <button key="play" className={"chooseopt" + (preferPlay ? " primary" : "")} onClick={onPlay}>
      <span className="chooseic" aria-hidden="true">★</span>
      <span className="choosetx"><b>{t("fbPlay")}</b><small>{t("fbPlaySub")}</small></span>
    </button>
  );
  return (
    <div className="sheetwrap" role="dialog" aria-modal="true" aria-label={t("fbChooseH")} onClick={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="choosecard" onClick={(e) => e.stopPropagation()}>
        <h3>{t("fbChooseH")}</h3>
        {preferPlay ? [play, inApp] : [inApp, play]}
        <button className="choosecancel" onClick={onClose} autoFocus>{t("cancel")}</button>
      </div>
    </div>
  );
}
