import React, { useState } from "react";
import { LANGS } from "../lib/util.js";
import { useT } from "../lib/i18nContext.js";

// ---- Settings (your own DeepL key) -----------------------------------------
export default function Settings({ profile, hasOwnKey, targetLang, onSave, onSaveTarget, onBack, missingAlbums, onBackfill, missingTitles, onBackfillTitles }) {
  const t = useT();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [bfBusy, setBfBusy] = useState(false);
  const [bfMsg, setBfMsg] = useState("");
  const [btBusy, setBtBusy] = useState(false);
  const [btMsg, setBtMsg] = useState("");
  const used = profile?.trial_used || 0;
  const save = async () => { if (!key.trim() || busy) return; setBusy(true); const ok = await onSave(key.trim()); setBusy(false); if (ok) setKey(""); };
  const remove = async () => { setBusy(true); await onSave(""); setBusy(false); };
  const runBackfill = async () => {
    if (bfBusy) return;
    setBfBusy(true); setBfMsg("");
    const { total, filled } = await onBackfill();
    setBfBusy(false); setBfMsg(t("albumsFilled", { filled, total }));
  };
  const runBackfillTitles = async () => {
    if (btBusy) return;
    setBtBusy(true); setBtMsg("");
    const { total, filled } = await onBackfillTitles();
    setBtBusy(false); setBtMsg(t("titlesDone", { filled, total }));
  };
  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label="Back">←</button>
        <div className="ttl"><h2>{t("settings")}</h2><p>{t("settingsSub")}</p></div>
      </div>
      <div className="editor">
        <div className="setcard" style={{ marginBottom: 16 }}>
          <h3>{t("translateInto")}</h3>
          <p className="setstate">{t("translateIntoBody")}</p>
          <select value={targetLang || "English"} onChange={(e) => onSaveTarget(e.target.value)}>
            {LANGS.map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
          </select>
        </div>
        <div className="setcard">
          <h3>{t("yourKey")}</h3>
          {hasOwnKey ? (
            <p className="setstate ok">{t("keySetOk")}</p>
          ) : (
            <p className="setstate">{t("onShared", { used })}</p>
          )}
          <div className="pwfield">
            <input type={showKey ? "text" : "password"} value={key} placeholder={hasOwnKey ? t("enterNewKey") : t("pasteApiKey")}
              onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
            <button type="button" className="pweye" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? t("hide") : t("show")}>{showKey ? t("hide") : t("show")}</button>
          </div>
          <div className="setbtns">
            <button className="save" onClick={save} disabled={busy || !key.trim()}>{busy ? t("saving") : t("saveKey")}</button>
            {hasOwnKey && <button className="cancel" onClick={remove} disabled={busy}>{t("remove")}</button>}
          </div>
          <a className="findbtn" href="https://www.deepl.com/pro-api" target="_blank" rel="noreferrer">{t("getKey")}</a>
          <p className="hint2">{t("deeplHint")}</p>
        </div>

        {(missingAlbums > 0 || bfMsg) && (
          <div className="setcard" style={{ marginTop: 16 }}>
            <h3>{t("fixAlbumsH")}</h3>
            <p className="setstate">{t("fixAlbumsBody", { n: missingAlbums })}</p>
            <div className="setbtns">
              <button className="save" onClick={runBackfill} disabled={bfBusy || missingAlbums === 0}>
                {bfBusy ? t("fixAlbumsBusy") : t("fixAlbumsBtn")}
              </button>
            </div>
            {bfMsg && <p className="setstate ok">{bfMsg}</p>}
          </div>
        )}

        {(missingTitles > 0 || btMsg) && (
          <div className="setcard" style={{ marginTop: 16 }}>
            <h3>{t("transTitlesH")}</h3>
            <p className="setstate">{t("transTitlesBody", { n: missingTitles })}</p>
            <div className="setbtns">
              <button className="save" onClick={runBackfillTitles} disabled={btBusy || missingTitles === 0}>
                {btBusy ? t("transTitlesBusy") : t("transTitlesBtn")}
              </button>
            </div>
            {btMsg && <p className="setstate ok">{btMsg}</p>}
          </div>
        )}
      </div>
    </>
  );
}
