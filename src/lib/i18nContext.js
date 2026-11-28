import React from "react";
import { makeT } from "../i18n.js";

// UI language follows the user's chosen target language, via this context.
export const I18n = React.createContext(makeT("English"));
export const useT = () => React.useContext(I18n);
