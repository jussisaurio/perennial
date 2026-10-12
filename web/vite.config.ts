import { sentryVitePlugin } from "@sentry/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import pkg from "./package.json" with { type: "json" };

// Source maps for readable error reports: uploaded to Sentry during the
// production build (tagged with the commit), then deleted, so they are never
// served. Off unless the build has a token, org and project (Railway build vars).
const sentry = !!(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT);

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { sourcemap: sentry ? "hidden" : false },
  plugins: [
    react(),
    sentry &&
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        release: { name: process.env.VITE_RELEASE },
        sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
        telemetry: false,
      }),
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
      workbox: {
        // Hashed files are precached: they never change, so offline works.
        globPatterns: ["**/*.{js,css,svg,wasm,json}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // The page itself comes from the network whenever there is one, so every load
        // runs the current release. The cached copy is only for offline. (Served from
        // the precache first, each load ran the release before, and nothing reloads.)
        navigateFallback: null,
        runtimeCaching: [{ urlPattern: ({ request }) => request.mode === "navigate", handler: "NetworkFirst", options: { cacheName: "pages", networkTimeoutSeconds: 4 } }],
      },
    }),
  ],
  server: {
    // Decks live in ../decks (shared with the server and the deck scripts).
    fs: { allow: [".."] },
    proxy: { "/api": `http://localhost:${process.env.SYNC_PORT ?? 8787}` },
  },
});
