import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App.jsx";
import "./index.css";

// Keep the installed app (PWA / TWA) on the latest deploy instead of serving a
// stale cached build. In autoUpdate mode the new service worker activates as
// soon as it's fetched (skipWaiting + clientsClaim); we then reload once it
// takes control so the open page swaps to the fresh build. We also poll for a
// new worker every minute, so a long-resident app still picks updates up.
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (reg) setInterval(() => { reg.update().catch(() => {}); }, 60 * 1000);
  },
});
if ("serviceWorker" in navigator) {
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;          // a new worker took over → load its build once
    reloaded = true;
    window.location.reload();
  });
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
