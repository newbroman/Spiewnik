import React, { useState } from "react";
import { LANGS } from "../lib/util.js";
import { makeT } from "../i18n.js";
import { useT } from "../lib/i18nContext.js";

// ---- First-run welcome: pick the language to translate into ----------------
export default function Welcome({ onPick }) {
  const t = useT();
  const [lang, setLang] = useState("English");
  const [busy, setBusy] = useState(false);
  const go = async () => { if (busy) return; setBusy(true); await onPick(lang); };
  // Preview the chosen language live as they pick it.
  const tp = makeT(lang);
  return (
    <div className="lock">
      <div className="lockcard">
        <div className="eyebrow">{tp("wEyebrow")}</div>
        <h1>{tp("wTitle")}</h1>
        <p>{tp("wBody")}</p>
        <select className="welcomesel" value={lang} onChange={(e) => setLang(e.target.value)}>
          {LANGS.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
        </select>
        <button onClick={go} disabled={busy}>{busy ? "…" : tp("cont")}</button>
      </div>
    </div>
  );
}
