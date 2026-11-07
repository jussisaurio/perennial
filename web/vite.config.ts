import { sentryVitePlugin } from "@sentry/vite-plugin";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vite";
import pkg from "./package.json" with { type: "json" };

// Source maps for readable error reports: uploaded to Sentry during the
// production build (tagged with the commit), then deleted, so they are never
// served. Off on purpose when the build has no token (local builds); a token
// without an org or project is a broken setup and fails the build (#328).
const sentry = !!process.env.SENTRY_AUTH_TOKEN;
if (sentry && !(process.env.SENTRY_ORG && process.env.SENTRY_PROJECT)) {
  throw new Error("SENTRY_AUTH_TOKEN is set, but SENTRY_ORG or SENTRY_PROJECT is not: source maps can't upload");
}

// The first screens' fonts, fetched with the page and not only once the CSS is applied.
// Without this, the first layouts look up fallback fonts and lay out again when each
// font comes (#569). The files are hashed, so the links are added at build time.
const FIRST_FONTS = ["onest-latin-wght-normal", "gloock-latin-400-normal"];
const preloadFonts = (): Plugin => ({
  name: "preload-fonts",
  apply: "build",
  transformIndexHtml(_html, ctx) {
    if (!ctx.bundle) throw new Error("preload-fonts: no bundle (it runs in builds only)");
    const files = Object.keys(ctx.bundle);
    return FIRST_FONTS.map((font) => {
      const file = files.find((f) => f.startsWith(`assets/${font}-`) && f.endsWith(".woff2"));
      if (!file) throw new Error(`preload-fonts: no ${font} woff2 in the build`);
      return { tag: "link", attrs: { rel: "preload", href: `/${file}`, as: "font", type: "font/woff2", crossorigin: "" }, injectTo: "head" };
    });
  },
});

// Each deck ships as two chunks (#608): its words, which Today and the plan need,
// and its sentences (about 3/4 of the bytes), fetched right after. decks/<lang>/deck.json
// stays the one source; `deck.json?part=words|sentences` is a slice of it. A chunk
// has no imports, so its hash changes only with its own content: the words part leaves
// out the deck's version, which goes up with every sentence edit.
const PART = /\/decks\/([a-z]+)\/deck\.json\?part=(words|sentences)(&|$)/;
const deckParts = (): Plugin => ({
  name: "deck-parts",
  load(id) {
    const m = PART.exec(id);
    if (!m) return null;
    const file = id.slice(0, id.indexOf("?"));
    this.addWatchFile(file);
    const deck = JSON.parse(readFileSync(file, "utf8")) as { lang: string; words: unknown[]; sentences: { retired?: boolean }[] };
    // Retired sentences are never shown, so they don't ship. Retired words do: old reviews resolve through them.
    const part = m[2] === "words" ? { lang: deck.lang, words: deck.words } : { lang: deck.lang, sentences: deck.sentences.filter((s) => !s.retired) };
    // JSON.parse of a string, as Vite's JSON plugin does for big files: it parses faster than an object literal.
    return { code: `export default JSON.parse(${JSON.stringify(JSON.stringify(part))});`, moduleType: "js" };
  },
});

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    sourcemap: sentry ? "hidden" : false,
    rolldownOptions: {
      // deck-es-words-<hash>.js, not two files both named deck-<hash>.js.
      output: {
        chunkFileNames: (chunk) => {
          const m = chunk.facadeModuleId && PART.exec(chunk.facadeModuleId);
          return m ? `assets/deck-${m[1]}-${m[2]}-[hash].js` : "assets/[name]-[hash].js";
        },
      },
    },
  },
  plugins: [
    react(),
    preloadFonts(),
    deckParts(),
    // React Compiler memoizes components and hooks at build time (#452).
    babel({ presets: [reactCompilerPreset()] }),
    sentry &&
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        // || "dev": the release the app reports (src/version.ts), so maps match its errors even when the build passes an empty value.
        release: { name: process.env.VITE_RELEASE || "dev" },
        sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
        telemetry: false,
        // The plugin only logs a failed release or upload and the build goes on, so
        // production stacks stay minified with no sign of it (#328). Fail the build.
        errorHandler: (err) => {
          throw err;
        },
      }),
  ],
  server: {
    // Decks live in ../decks (shared with the server and the deck scripts).
    fs: { allow: [".."] },
    proxy: { "/api": `http://localhost:${process.env.SYNC_PORT ?? 8787}` },
  },
});
