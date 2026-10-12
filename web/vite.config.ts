import { sentryVitePlugin } from "@sentry/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
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
  ],
  server: {
    // Decks live in ../decks (shared with the server and the deck scripts).
    fs: { allow: [".."] },
    proxy: { "/api": `http://localhost:${process.env.SYNC_PORT ?? 8787}` },
  },
});
