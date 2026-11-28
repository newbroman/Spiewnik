import React, { useState } from "react";
import { norm } from "../lib/util.js";
import { useT } from "../lib/i18nContext.js";

// ---- Import a shared song list (titles only, no lyrics) ---------------------
export default function ImportList({ list, songs, offline, onAdd, onSkip }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const have = (x) => songs.some((s) => norm(s.title) === norm(x.title) && norm(s.artist) === norm(x.artist));
  const fresh = list.filter((x) => !have(x));
  const add = async () => { if (busy || !fresh.length) return; setBusy(true); await onAdd(fresh); setBusy(false); };
  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onSkip} aria-label={t("back")}>←</button>
        <div className="ttl"><h2>{t("importH")}</h2><p>{t("importCount", { n: list.length })}</p></div>
      </div>
      <div className="editor">
        {list.length === 0 ? (
          <div className="emptylib">{t("importNone")}</div>
        ) : (
          <>
            <p className="setstate">{t("importBody")}</p>
            <div className="results">
              {list.map((x, i) => (
                <div key={i} className={"sresult static" + (have(x) ? " have" : "")}>
                  <span className="meta">
                    <h3>{x.title}</h3>
                    <p>{[x.artist, x.language, have(x) ? t("importHave") : ""].filter(Boolean).join(" · ")}</p>
                  </span>
                </div>
              ))}
            </div>
            <div className="actions">
              <button className="save" onClick={add} disabled={busy || offline || fresh.length === 0}>
                {busy ? t("importAdding") : t("importAdd")}
              </button>
              <button className="cancel" onClick={onSkip}>{t("importSkip")}</button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
