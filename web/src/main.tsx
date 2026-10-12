import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initObservability, reactErrorHandler } from "./observability";
import { initTheme } from "./ui/theme";
import { loadServerInfo } from "./data/server";
import { registerServiceWorker } from "./serviceWorker";

initTheme();
initObservability();
// What the server can do, and whether this app is still new enough for it.
loadServerInfo();
void navigator.storage?.persist?.();
// Production only: dev has no built /sw.js.
if (import.meta.env.PROD) addEventListener("load", () => void registerServiceWorker());

// After a deploy, this page may ask for last release's code chunks, which are
// gone: load the new release instead (once a minute at most, so never a loop).
window.addEventListener("vite:preloadError", (e) => {
  try {
    const last = Number(sessionStorage.getItem("reloaded-for-chunk") ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem("reloaded-for-chunk", String(Date.now()));
  } catch {
    // No storage: reload anyway.
  }
  e.preventDefault();
  location.reload();
});

async function boot() {
  // Dev-only switches like ?demo=es. Removed from production builds, except
  // the one the UI performance run measures (VITE_DEV_TOOLS=1, perf/ui.ts).
  if (import.meta.env.DEV || import.meta.env.VITE_DEV_TOOLS === "1") await (await import("./dev/boot")).devBoot();
  createRoot(document.getElementById("root")!, { onUncaughtError: reactErrorHandler(), onCaughtError: reactErrorHandler(), onRecoverableError: reactErrorHandler() }).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void boot();
