import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { initObservability, reportReactError } from "./observability";
import { afterPaint } from "./ui/afterPaint";
import { initTheme } from "./ui/theme";
import { takeGiftFromUrl } from "./data/gift";
import { yieldToBrowser } from "./lib/yield";
import { Settling } from "./ui/Settling";

// The app's code loads in two steps, each run in its own task (#569). As one
// step it was a ~100 ms task at CPU 10× before the first paint. First Effect
// and the wire schemas, which are built as they load (about half the time); then the rest.
const App = lazy(async () => {
  await import("perennial-contract");
  await yieldToBrowser();
  return import("./App");
});

initTheme();
// Error reports load after the first paint, out of this first task (#481). Reports made before then wait for them.
afterPaint(() => void initObservability());
// What the server can do, and whether this app is still new enough for it.
// After the first paint too: its first Schema decode and Effect run are ~25 ms at CPU 10× (#481).
afterPaint(() => void import("./data/server").then((m) => m.loadServerInfo()));
void navigator.storage?.persist?.();

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
  // A gifted seed in the address (#213): kept on this device, and taken out of the address.
  takeGiftFromUrl();
  // Dev-only switches like ?demo=es. Removed from production builds, except
  // the one the UI performance run measures (VITE_DEV_TOOLS=1, perf/ui.ts).
  if (import.meta.env.DEV || import.meta.env.VITE_DEV_TOOLS === "1") await (await import("./dev/boot")).devBoot();
  createRoot(document.getElementById("root")!, { onUncaughtError: reportReactError, onCaughtError: reportReactError, onRecoverableError: reportReactError }).render(
    <StrictMode>
      <Suspense fallback={<Settling />}>
        <App />
      </Suspense>
    </StrictMode>,
  );
}
void boot();
