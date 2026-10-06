import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During local dev, proxy /api to your deployed Vercel functions so the app
// can reach Musixmatch without running a separate backend locally. Set
// VITE_PROXY_TARGET to your deployed URL, e.g. https://spiewnik.vercel.app
export default defineConfig(() => {
  const target = process.env.VITE_PROXY_TARGET;
  return {
    plugins: [react()],
    server: target
      ? { proxy: { "/api": { target, changeOrigin: true, secure: true } } }
      : undefined,
  };
});
