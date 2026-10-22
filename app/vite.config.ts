import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// D3/D5/D6: fully offline. The strict CSP is injected into the BUILT HTML
// only (dev HMR needs a ws: connect). sqlite-wasm resolves its .wasm via
// new URL(..., import.meta.url), so it must stay out of the dep optimizer.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' blob:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'none'",
].join("; ");

export default defineConfig({
  base: "./",
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
  },
  plugins: [
    react({}),
    {
      name: "finplanner-csp",
      apply: "build",
      transformIndexHtml(html) {
        return html.replace(
          "<head>",
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        );
      },
    },
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [],
      manifest: {
        name: "FinPlanner",
        short_name: "FinPlanner",
        description: "Long-term household financial planning — fully local, offline-only.",
        start_url: ".",
        display: "standalone",
        background_color: "#0e1116",
        theme_color: "#0e1116",
        // TODO(M4 beta polish): add real icons for installability.
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,wasm,png,webmanifest}"],
        navigateFallback: "index.html",
      },
    }),
  ],
});
