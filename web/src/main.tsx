import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initObservability, reactErrorHandler } from "./observability";
import { initTheme } from "./ui/theme";

initTheme();
initObservability();
void navigator.storage?.persist?.();

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
