// The first screen: what Perennial is, shown with a garden you can hover,
// for each language. "Start learning" makes an anonymous account and the
// course in one step; nothing to set up, no email needed yet.

import { useEffect, useMemo, useState } from "react";
import { COURSE_LANGUAGES } from "../content/languages";
import { ensureUser } from "../data/auth";
import { useDeck } from "../data/learner";
import { APP_VERSION } from "../version";
import { SignIn } from "./Account";
import { Garden, GrowthStrip, showcaseGarden } from "./Garden";
import { GardenWalk, showcaseWalkPlants } from "./GardenWalk";

import { FlowerIcon, SproutMark } from "./icons";

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

/** The first write: an anonymous account (if there is none yet) and the course. */
export async function startCourse(lang: string, minutes: number) {
  await ensureUser();
  const res = await fetch("/api/write", {
    method: "POST",
    headers: { "content-type": "application/json", "x-perennial-version": APP_VERSION },
    body: JSON.stringify({ mutations: [{ type: "course.upsert", row: { lang, minutes } }] }),
  });
  if (!res.ok) throw new Error(`Could not start (${res.status})`);
}

export function Onboarding({ onStarted, signedIn }: { onStarted: (lang: string) => void; signedIn: boolean }) {
  const draft = readDraft();
  const [lang, setLang] = useState(() => draft.lang ?? "es");
  const [minutes, setMinutes] = useState(draft.minutes ?? 7);
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [walking, setWalking] = useState(false);
  useEffect(() => saveDraft({ lang, minutes }), [lang, minutes]);
  const deck = useDeck(lang);
  const showcase = useMemo(() => (deck ? showcaseGarden(deck) : null), [deck]);
  const name = COURSE_LANGUAGES.find((l) => l.code === lang)?.name ?? lang;
  const walkSource = useMemo(() => (deck && walking ? showcaseWalkPlants(deck) : null), [deck, walking]);

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      await startCourse(lang, minutes);
      onStarted(lang);
    } catch {
      setError("Could not start. Check your internet connection and try again.");
      setBusy(false);
    }
  };

  if (walking) return <GardenWalk lang={lang} source={walkSource} onExit={() => setWalking(false)} />;

  return (
    <div className="page narrow stagger landing">
      <span className="wordmark">
        <SproutMark size={26} /> perennial
      </span>
      <h1 style={{ marginTop: "2rem" }}>Grow a language, a few minutes a day.</h1>
      <p className="lede">
        Every word you learn grows into a plant. It grows each time you remember it. You learn the most common words first, in real sentences. You choose how many minutes per day. Missed days do not pile up.
      </p>

      <div className="choice lang-choice landing-langs" role="radiogroup" aria-label="Language to learn">
        {COURSE_LANGUAGES.map((l) => (
          <label key={l.code}>
            <input type="radio" name="lang" value={l.code} checked={lang === l.code} onChange={() => setLang(l.code)} />
            <span>
              <strong>{l.name}</strong>
              <span className="muted small">{l.blurb}</span>
            </span>
          </label>
        ))}
      </div>
      <figure className="landing-garden" aria-label={`A ${name} garden after a few months`}>
        <Garden data={showcase} showcase />
        <figcaption className="muted small">A {name} garden after a few months of practice. Point at a plant to see its word.</figcaption>
      </figure>
      <button className="walk-link" onClick={() => setWalking(true)}>
        <FlowerIcon size={18} /> Walk through this garden in 3D
      </button>
      <GrowthStrip />

      <section className="form">
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
        <span className="muted small">Lessons are in English. More languages will come later.</span>
      </section>
      <div className="row" style={{ marginTop: "1.5rem" }}>
        <button className="primary wide" onClick={() => void start()} disabled={busy}>
          {busy ? "Starting…" : `Start learning ${name}`}
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="muted small">Free. No account needed to start. Add your email later to keep your garden on all your devices.</p>

      {!signedIn && (
        <>
          <button className="ghost link" onClick={() => setLinking(!linking)} aria-expanded={linking}>
            I already use Perennial →
          </button>
          {linking && (
            <section className="panel">
              <h2 style={{ marginTop: 0 }}>Sign in</h2>
              <p className="muted small">Sign in with your email. Your garden appears here after a moment.</p>
              <SignIn cta="Sign in" />
            </section>
          )}
        </>
      )}
    </div>
  );
}
