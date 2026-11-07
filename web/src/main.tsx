import { startBoot } from "./data/bootRequest";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { reportReactError } from "./observability";
import { afterPaint } from "./ui/afterPaint";
import { initTheme } from "./ui/theme";
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

// What the app needs to start (session, rows, server info): asked now, so it arrives while the code loads (#602).
void startBoot();
initTheme();
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
  // The demo (?demo, dev/boot.ts), in production too (#751): its code loads only when the address asks for it.
  const root = createRoot(document.getElementById("root")!, { onUncaughtError: reportReactError, onCaughtError: reportReactError, onRecoverableError: reportReactError });
  let Jump = null;
  if (new URLSearchParams(location.search).has("demo")) {
    // Making a demo learner takes a few seconds: the sprout, not a blank page.
    root.render(<Settling />);
    Jump = await (await import("./dev/boot")).devBoot();
  }
  root.render(
    <StrictMode>
      <Suspense fallback={<Settling />}>{Jump ? <Jump /> : <App />}</Suspense>
    </StrictMode>,
  );
}
void boot();
