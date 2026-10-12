// Developer tools in Settings. Only in `vite dev`; not in production builds.

import { useState } from "react";
import { COURSE_LANGUAGES } from "../content/languages";
import type { DeckLang } from "../deck/schema";

export default function DevTools() {
  const [lang, setLang] = useState<DeckLang>("es");
  const [count, setCount] = useState(150);
  const [busy, setBusy] = useState(false);
  return (
    <section>
      <h2>Developer tools</h2>
      <div className="form">
        <p className="muted small">
          Only in dev mode. Makes a new anonymous learner with a made-up review history of 90 days, replacing the current one. You can also open <code>?demo=es:150</code> or <code>?demo=off</code>.
        </p>
        <div className="row">
          <select value={lang} onChange={(e) => setLang(e.target.value as DeckLang)} aria-label="Demo language">
            {COURSE_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
          <select value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Words studied">
            {[10, 30, 150, 10_000].map((n) => (
              <option key={n} value={n}>
                {n === 10_000 ? "All words studied" : `${n} words studied`}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button
            className="primary"
            disabled={busy}
            // Through the boot path (dev/boot.ts): seeding here would race the reload
            // that follows its sign-out (App reloads on every change of user).
            onClick={() => {
              setBusy(true);
              location.href = `/?demo=${lang}:${count}#/garden`;
            }}
          >
            {busy ? "Working…" : "Make demo learner and open the garden"}
          </button>
          <button className="ghost" disabled={busy} onClick={() => (location.href = "/?demo=off#/today")}>
            Delete demo learner
          </button>
        </div>
      </div>
    </section>
  );
}
