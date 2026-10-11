import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Perennial",
        short_name: "Perennial",
        description: "Learn a language a few minutes a day.",
        theme_color: "#1d1b18",
        background_color: "#f7f5f0",
        display: "standalone",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg,wasm,json}"], maximumFileSizeToCacheInBytes: 4 * 1024 * 1024 },
    }),
  ],
  server: {
    // Decks live in ../decks (shared with the server and the deck scripts).
    fs: { allow: [".."] },
    proxy: { "/api": `http://localhost:${process.env.SYNC_PORT ?? 8787}` },
  },
});
