import React from "react";
import { I18n } from "../lib/i18nContext.js";
import { makeT } from "../i18n.js";

export default function Shell({ lang, children }) {
  return (
    <div className="kl-root">
      <I18n.Provider value={makeT(lang || "English")}>
        <div className="app">{children}</div>
      </I18n.Provider>
    </div>
  );
}
