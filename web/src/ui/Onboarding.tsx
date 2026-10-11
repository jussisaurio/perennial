import { useEffect, useState } from "react";
import { aiMode } from "../ai/backend";
import { COURSE_LANGUAGES, NATIVE_LANGUAGE } from "../content/languages";
import { uid, write } from "../db/db";
import type { Course } from "../model";
import { GrowthStrip } from "./Garden";
import { SproutMark } from "./icons";
import { SignIn, useAccount } from "./Account";
import { AISettings, SyncSettings } from "./Settings";

// Choices survive a reload before "Start learning" (a per-browser convenience).
const DRAFT_KEY = "perennial-onboarding";
type Draft = { lang?: string; minutes?: number };
function readDraft(): Draft {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}") as Draft;
  } catch {
    return {};
  }
}
function saveDraft(d: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* private mode */
  }
}

export function Onboarding({ existing = [], onCreated, onCancel }: { existing?: Course[]; onCreated: (id: string) => void; onCancel?: () => void }) {
  const adding = !!onCancel;
  const taken = new Set(existing.map((c) => c.lang));
  const open = COURSE_LANGUAGES.filter((l) => !taken.has(l.code));
  const draft = readDraft();
  const [lang, setLang] = useState(() => (draft.lang && !taken.has(draft.lang) ? draft.lang : (open[0]?.code ?? "es")));
  const [minutes, setMinutes] = useState(draft.minutes ?? existing[0]?.minutes ?? 7);
  useEffect(() => saveDraft({ lang, minutes }), [lang, minutes]);
  // Decided once, so the section stays (showing "Connected") after setup succeeds.
  const [showAI, setShowAI] = useState(false);
  const [linking, setLinking] = useState(false);
  const { signedIn, me } = useAccount();
  useEffect(() => {
    void aiMode().then((m) => setShowAI(!m));
  }, []);

  const create = async () => {
    const id = uid();
    await write<Course>("courses", { id, lang, native: NATIVE_LANGUAGE, minutes, retention: 0.9, createdAt: Date.now(), freqCursor: 0 });
    onCreated(id);
  };
  const langName = COURSE_LANGUAGES.find((l) => l.code === lang)?.name ?? lang;

  if (adding && open.length === 0)
    return (
      <div className="page narrow">
        <h1>Add a language</h1>
        <p className="lede">You are already learning every language Perennial offers now: {COURSE_LANGUAGES.map((l) => l.name).join(" and ")}. More languages will come later.</p>
        <button className="secondary" onClick={onCancel}>
          Back
        </button>
      </div>
    );

  return (
    <div className="page narrow stagger">
      {adding ? (
        <h1>Add a language</h1>
      ) : (
        <>
          <span className="wordmark">
            <SproutMark size={26} /> perennial
          </span>
          <h1 style={{ marginTop: "2rem" }}>Grow a language, a few minutes a day.</h1>
          <p className="lede">
            Every word starts as a seed. It grows each time you remember it. You learn the most common words first, in real sentences. You choose how many minutes per day. Missed days do not pile up.
          </p>
          <GrowthStrip />
          <button className="ghost link" onClick={() => setLinking(!linking)} aria-expanded={linking}>
            I already use Perennial on another device →
          </button>
          {linking && (
            <section className="panel">
              <h2 style={{ marginTop: 0 }}>Sign in</h2>
              <p className="muted small">Sign in with the same email as on your other device. Your words appear here after a moment.</p>
              <SignIn cta="Sign in" />
              <details className="more">
                <summary>I use a sync code instead</summary>
                <p className="muted small">On your other device, open Settings → Sync and copy your sync code.</p>
                <SyncSettings mode="link" />
              </details>
            </section>
          )}
        </>
      )}
      <section className="form">
        <div className="form-label">
          I want to learn
          <div className="choice lang-choice" role="radiogroup" aria-label="Language to learn">
            {COURSE_LANGUAGES.map((l) => (
              <label key={l.code} className={taken.has(l.code) ? "disabled" : undefined}>
                <input type="radio" name="lang" value={l.code} checked={lang === l.code} disabled={taken.has(l.code)} onChange={() => setLang(l.code)} />
                <span>
                  <strong>{l.name}</strong>
                  <span className="muted small">{taken.has(l.code) ? "You are already learning this" : l.blurb}</span>
                </span>
              </label>
            ))}
          </div>
          <span className="muted small">Lessons are in English. More languages will come later.</span>
        </div>
        <label>
          Time per day
          <div className="chips" role="radiogroup" aria-label="Minutes per day">
            {[5, 7, 10, 15].map((m) => (
              <button key={m} role="radio" aria-checked={m === minutes} className={m === minutes ? "chip on" : "chip"} onClick={() => setMinutes(m)}>
                {m} min
              </button>
            ))}
          </div>
        </label>
      </section>
      {showAI && !linking && (
        <section>
          <h2>Turn on AI</h2>
          <p className="muted small">The AI writes example sentences at your level.</p>
          <div className="panel form">
            <div>
              <strong>Perennial AI</strong>
              <p className="muted small" style={{ margin: "0.2rem 0 0" }}>
                Free to start. Nothing to set up. Your words also sync on all your devices.
              </p>
            </div>
            {signedIn ? (
              <p className="inline-choice">
                Signed in as <strong>{me?.email}</strong>. Perennial AI is on.
              </p>
            ) : (
              <SignIn cta="Start free with my email" />
            )}
          </div>
          {!signedIn && (
            <details className="more" style={{ marginTop: "0.75rem" }}>
              <summary>Use my own API key or a local model</summary>
              <p className="muted small">You can use OpenAI, Anthropic, or a model on your own computer (Ollama).</p>
              <AISettings />
            </details>
          )}
          {!signedIn && <p className="muted small">Without AI, the app has no ready words: you type each word yourself.</p>}
        </section>
      )}
      <div className="row" style={{ marginTop: "1.5rem" }}>
        <button className="primary wide" onClick={() => void create()}>
          {adding ? `Add ${langName}` : "Start learning"}
        </button>
        {onCancel && (
          <button className="ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
