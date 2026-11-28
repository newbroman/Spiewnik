import React, { useState } from "react";
import { supabase } from "../supabase.js";
import { useT } from "../lib/i18nContext.js";

// Map Supabase auth errors (English, server-side) to UI keys. Unknown ones get
// the generic message so nothing untranslated reaches the screen.
export function authErrorKey(ex) {
  const m = String((ex && (ex.message || ex.error_description || ex.code)) || "").toLowerCase();
  const code = String((ex && ex.code) || "").toLowerCase();
  if (code === "invalid_credentials" || m.includes("invalid login")) return "errBadLogin";
  if (code === "email_not_confirmed" || m.includes("not confirmed")) return "errNotConfirmed";
  if (code === "user_already_exists" || m.includes("already registered") || m.includes("already exists")) return "errExists";
  if (code === "weak_password" || m.includes("password should") || m.includes("at least 6")) return "errWeakPw";
  if (code.includes("rate_limit") || m.includes("rate limit") || m.includes("too many") || (ex && ex.status === 429)) return "errRate";
  if (m.includes("failed to fetch") || m.includes("network") || m.includes("load failed")) return "errNetwork";
  return "errGeneric";
}

// ---- Sign in / sign up / reset ----------------------------------------------
// `notice` (optional) is shown above the form, e.g. "Sign in to add the shared
// songs". `onDemo` opens the read-only sample song.
export default function Auth({ initialMode = "signin", notice = "", onDemo }) {
  const t = useT();
  const [mode, setMode] = useState(initialMode); // signin | signup | reset
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [showPw, setShowPw] = useState(false);

  const switchMode = (m) => { setErr(""); setNote(""); setMode(m); };

  const submit = async () => {
    if (busy) return;
    const e = email.trim();
    if (mode === "reset") {
      if (!e) { setErr(t("errEmail")); return; }
      setBusy(true); setErr(""); setNote("");
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(e, { redirectTo: window.location.origin });
        if (error) throw error;
        setNote(t("resetSent"));
      } catch (ex) { setErr(t(authErrorKey(ex))); }
      finally { setBusy(false); }
      return;
    }
    if (!e || !pw) { setErr(t("errEmailPw")); return; }
    setBusy(true); setErr(""); setNote("");
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: e, password: pw });
        if (error) throw error;
        if (!data.session) { setNote(t("noteCreated")); setMode("signin"); }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: e, password: pw });
        if (error) throw error;
      }
    } catch (ex) {
      setErr(t(authErrorKey(ex)));
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    if (busy) return;
    setErr(""); setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
      if (error) throw error;
      // On success the browser navigates away to Google.
    } catch (ex) { setErr(t(authErrorKey(ex))); setBusy(false); }
  };

  const sub = mode === "reset" ? t("resetBody") : mode === "signup" ? t("subSignUp") : t("subSignIn");

  return (
    <div className="lock">
      <div className="lockcard">
        <div className="eyebrow">{t("tagline")}</div>
        <h1>Śpiewnik</h1>
        {notice && <div className="authnotice">{notice}</div>}
        {mode === "reset" && <h2 className="authsubh">{t("resetH")}</h2>}
        <p>{sub}</p>

        {mode !== "reset" && (
          <>
            <button type="button" className="googlebtn" onClick={google} disabled={busy}>
              <span className="gmark" aria-hidden="true">G</span>{t("authGoogle")}
            </button>
            <p className="googlenote">{t("authGoogleNote")}</p>
            <div className="author"><span>{t("authOr")}</span></div>
          </>
        )}

        <input type="email" value={email} placeholder={t("email")} autoComplete="email"
          onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        {mode !== "reset" && (
          <div className="pwwrap">
            <input type={showPw ? "text" : "password"} value={pw} placeholder={t("password")}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
            <button type="button" className="pweye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? t("hide") : t("show")}>{showPw ? t("hide") : t("show")}</button>
          </div>
        )}
        {err && <div className="lockerr" role="alert">{err}</div>}
        {note && <div className="locknote">{note}</div>}
        <button onClick={submit} disabled={busy}>
          {busy ? "…" : mode === "reset" ? t("resetSend") : mode === "signup" ? t("btnCreate") : t("btnSignIn")}
        </button>

        {mode === "signin" && (
          <button className="linkbtn" onClick={() => switchMode("reset")}>{t("forgotPw")}</button>
        )}
        {mode === "reset" ? (
          <button className="linkbtn" onClick={() => switchMode("signin")}>{t("backToSignIn")}</button>
        ) : (
          <button className="linkbtn" onClick={() => switchMode(mode === "signup" ? "signin" : "signup")}>
            {mode === "signup" ? t("toSignIn") : t("toSignUp")}
          </button>
        )}

        {onDemo && mode !== "reset" && (
          <div className="demoentry">
            <button type="button" className="demobtn" onClick={onDemo}>♪ {t("tryDemo")}</button>
            <span>{t("tryDemoSub")}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Shown after following a password-reset link (PASSWORD_RECOVERY) --------
export function SetNewPassword({ onDone }) {
  const t = useT();
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    if (busy) return;
    if (pw.length < 6) { setErr(t("errWeakPw")); return; }
    setBusy(true); setErr("");
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      onDone();
    } catch (ex) { setErr(t(authErrorKey(ex))); setBusy(false); }
  };
  return (
    <div className="lock">
      <div className="lockcard">
        <div className="eyebrow">{t("tagline")}</div>
        <h1>Śpiewnik</h1>
        <h2 className="authsubh">{t("newPwH")}</h2>
        <p>{t("newPwBody")}</p>
        <div className="pwwrap">
          <input type={showPw ? "text" : "password"} value={pw} placeholder={t("newPwPh")} autoComplete="new-password" autoFocus
            onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
          <button type="button" className="pweye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? t("hide") : t("show")}>{showPw ? t("hide") : t("show")}</button>
        </div>
        {err && <div className="lockerr" role="alert">{err}</div>}
        <button onClick={save} disabled={busy}>{busy ? "…" : t("newPwSave")}</button>
      </div>
    </div>
  );
}
