import React, { useState } from "react";
import { LANGS } from "../lib/util.js";
import { CHARS_PER_SONG, trialLeft } from "../lib/translate.js";
import { useT } from "../lib/i18nContext.js";

const DEEPL_SIGNUP = "https://www.deepl.com/pro-api";

// ---- Settings (translation language, allowance, your own DeepL key) ---------
// `usage` is { hasKey, trial:{used,limit}, ai:{used,limit} } from the server
// (null if not known yet). `onSave(key)` goes through /api/translate op:"setkey".
export default function Settings({ usage, hasOwnKey, targetLang, onSave, onSaveTarget, onBack, missingAlbums, onBackfill, missingTitles, onBackfillTitles }) {
  const t = useT();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [bfBusy, setBfBusy] = useState(false);
  const [bfMsg, setBfMsg] = useState("");
  const [btBusy, setBtBusy] = useState(false);
  const [btMsg, setBtMsg] = useState("");
  const left = trialLeft(usage);
  const fmt = (n) => { try { return n.toLocaleString(); } catch { return String(n); } };
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
  const ai = usage && usage.ai;
  return (
    <>
      <div className="rbar">
        <button className="icbtn" onClick={onBack} aria-label={t("back")}>←</button>
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
          ) : left != null ? (
            <p className="setstate">{t("allowanceLeft", { songs: fmt(Math.floor(left / CHARS_PER_SONG)), chars: fmt(left) })}</p>
          ) : (
            <p className="setstate">{t("allowanceUnknown")}</p>
          )}
          {ai && typeof ai.limit === "number" && (
            <p className="setstate">{t("aiUsage", { used: fmt(ai.used || 0), limit: fmt(ai.limit) })}</p>
          )}
          <div className="keyexplain">
            <h4>{t("deeplWhatH")}</h4>
            <p>{t("deeplWhat")}</p>
            <p>{t("deeplSteps")}</p>
            <p className="keycard">{t("deeplCard")}</p>
            <a className="findbtn" href={DEEPL_SIGNUP} target="_blank" rel="noreferrer">{t("getKeyFree")}</a>
          </div>
          <div className="pwfield">
            <input type={showKey ? "text" : "password"} value={key} placeholder={hasOwnKey ? t("enterNewKey") : t("pasteApiKey")}
              autoCapitalize="off" autoCorrect="off" spellCheck={false}
              onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
            <button type="button" className="pweye" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? t("hide") : t("show")}>{showKey ? t("hide") : t("show")}</button>
          </div>
          <div className="setbtns">
            <button className="save" onClick={save} disabled={busy || !key.trim()}>{busy ? t("keyChecking") : t("saveKey")}</button>
            {hasOwnKey && <button className="cancel" onClick={remove} disabled={busy}>{t("remove")}</button>}
          </div>
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
