import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// During local dev, proxy /api to your deployed Vercel functions so the app
// can reach its backend without running one locally. Set VITE_PROXY_TARGET to
// your deployed URL, e.g. https://spiewnik-newbroman.vercel.app
export default defineConfig(() => {
  const target = process.env.VITE_PROXY_TARGET;
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["apple-touch-icon-180.png"],
        // The built app shell is precached for offline use. /api calls are not
        // part of the build, so they always hit the network. Song data comes
        // from Supabase; the app keeps its own copy of the library (and each
        // opened song) in IndexedDB — src/lib/offlineCache.js — and shows that
        // when offline. The service worker itself caches no song data.
        workbox: {
          navigateFallback: "/index.html",
          navigateFallbackDenylist: [/^\/api\//],
          globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        },
        manifest: {
          name: "Śpiewnik",
          short_name: "Śpiewnik",
          description: "Learn a language through songs — side-by-side lyrics, with practice and playback.",
          lang: "en",
          theme_color: "#1a2130",
          background_color: "#1a2130",
          display: "standalone",
          orientation: "portrait",
          start_url: "/",
          scope: "/",
          // Lets Android's share sheet send a Spotify/YouTube link to the app;
          // App.jsx picks /share?… up and opens Add a song with it.
          share_target: {
            action: "/share",
            method: "GET",
            params: { title: "title", text: "text", url: "url" },
          },
          icons: [
            { src: "icon-192.png", sizes: "192x192", type: "image/png" },
            { src: "icon-512.png", sizes: "512x512", type: "image/png" },
            { src: "maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          ],
        },
      }),
    ],
    server: target
      ? { proxy: { "/api": { target, changeOrigin: true, secure: true } } }
      : undefined,
  };
});
