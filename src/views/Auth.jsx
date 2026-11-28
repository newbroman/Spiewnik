import React, { useState } from "react";
import { supabase } from "../supabase.js";
import { useT } from "../lib/i18nContext.js";

// ---- Sign in / sign up ------------------------------------------------------
export default function Auth({ flash }) {
  const t = useT();
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [showPw, setShowPw] = useState(false);

  const submit = async () => {
    if (busy) return;
    const e = email.trim();
    if (!e || !pw) { setErr("Enter your email and a password."); return; }
    setBusy(true); setErr(""); setNote("");
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email: e, password: pw });
        if (error) throw error;
        if (!data.session) {
          setNote("Account created. Check your email for a confirmation link, then sign in.");
          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: e, password: pw });
        if (error) throw error;
      }
    } catch (ex) {
      setErr(ex.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lock">
      <div className="lockcard">
        <div className="eyebrow">{t("tagline")}</div>
        <h1>Śpiewnik</h1>
        <p>{mode === "signup" ? t("subSignUp") : t("subSignIn")}</p>
        <input type="email" value={email} autoFocus placeholder={t("email")} autoComplete="email"
          onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <div className="pwwrap">
          <input type={showPw ? "text" : "password"} value={pw} placeholder={t("password")}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          <button type="button" className="pweye" onClick={() => setShowPw((v) => !v)} aria-label={showPw ? t("hide") : t("show")}>{showPw ? t("hide") : t("show")}</button>
        </div>
        {err && <div className="lockerr">{err}</div>}
        {note && <div className="locknote">{note}</div>}
        <button onClick={submit} disabled={busy}>
          {busy ? "…" : mode === "signup" ? t("btnCreate") : t("btnSignIn")}
        </button>
        <button className="linkbtn" onClick={() => { setErr(""); setNote(""); setMode(mode === "signup" ? "signin" : "signup"); }}>
          {mode === "signup" ? t("toSignIn") : t("toSignUp")}
        </button>
      </div>
    </div>
  );
}
