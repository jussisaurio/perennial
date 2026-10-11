// Developer tools in Settings. Only in `vite dev`; not in production builds.

import { useState } from "react";
import { demoSize, removeDemo, seedDemo } from "./demo";

export default function DevTools() {
  const [lang, setLang] = useState<"es" | "de">("es");
  const [count, setCount] = useState(150);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    setDone("");
    await fn();
    setBusy(false);
    setDone(msg);
  };
  const max = demoSize(lang);
  return (
    <section>
      <h2>Developer tools</h2>
      <div className="form">
        <p className="muted small">
          Only in dev mode. A demo course has a made-up review history of 90 days. It stays on this device and does not sync. You can also open <code>?demo=es:150</code> or <code>?demo=off</code>.
        </p>
        <div className="row">
          <select value={lang} onChange={(e) => setLang(e.target.value as "es" | "de")} aria-label="Demo language">
            <option value="es">Spanish</option>
            <option value="de">German</option>
          </select>
          <select value={Math.min(count, max)} onChange={(e) => setCount(Number(e.target.value))} aria-label="Words studied">
            {[10, 50, 150, max].map((n) => (
              <option key={n} value={n}>
                {n === max ? `All ${max} words studied` : `${n} words studied`}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await seedDemo(lang, count);
                // The app picks its course when it starts, so start it again.
                location.hash = "#/garden";
                location.reload();
              }, "")
            }
          >
            {busy ? "Working…" : "Make demo course and open the garden"}
          </button>
          <button className="ghost" disabled={busy} onClick={() => void run(() => removeDemo(), "Demo courses removed.")}>
            Remove demo courses
          </button>
        </div>
        {done && (
          <p className="small" role="status">
            {done}
          </p>
        )}
      </div>
    </section>
  );
}
