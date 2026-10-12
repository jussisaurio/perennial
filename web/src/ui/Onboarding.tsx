// The first screen: what Perennial is, shown with a garden you can hover,
// for each language. "Start learning" makes an anonymous account and the
// course in one step; nothing to set up, no email needed yet.

import { farewell } from "../content/voice";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { COURSE_LANGUAGES, language } from "../content/languages";
import { isDeckLang } from "../deck/schema";
import { ensureUser } from "../data/auth";
import { postWrite } from "../data/http";
import { DAILY_MINUTES } from "../data/practice";
import { loadDeck } from "../data/deck";
import { useDeck } from "../data/learner";
import { track } from "../observability";
import { SignIn } from "./Account";
import { Garden, showcaseGarden } from "./Garden";
import { GardenWalk, showcaseWalkPlants } from "./GardenWalk";
import { showcaseVisitors } from "./visitors";
import { GrowthStrip } from "./plant";
import { FlowerIcon, SproutMark } from "./icons";

// The language choice survives a reload before "Start learning" (a per-browser convenience).
// Drafts saved by older builds also have `minutes`, which is no longer read.
const DRAFT_KEY = "perennial-onboarding";
type Draft = { lang?: string };
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

/**
 * A course being started: set before the first write, so the app shows a calm
 * loading screen (not this page again) while the new account and its course
 * arrive, even though signing in remounts everything in between. Kept outside
 * React for that reason, and observable, so a failure brings this page back
 * with its error.
 */
type Starting = { lang: string | null; error: string };
let starting: Starting = { lang: null, error: "" };
const startingListeners = new Set<() => void>();
function setStarting(next: Starting) {
  starting = next;
  for (const l of startingListeners) l();
}
const subscribeStarting = (l: () => void) => {
  startingListeners.add(l);
  return () => void startingListeners.delete(l);
};
export const useStartingCourse = () => useSyncExternalStore(subscribeStarting, () => starting);
export const courseArrived = () => {
  if (starting.lang) setStarting({ lang: null, error: "" });
};

/** The first write: an anonymous account (if there is none yet) and the course. */
export async function startCourse(lang: string) {
  setStarting({ lang, error: "" });
  try {
    await ensureUser();
    // The app no longer reads `minutes` (5 a day for everyone); older app versions still do.
    await postWrite([{ type: "course.upsert", row: { lang, minutes: DAILY_MINUTES } }]);
  } catch (e) {
    setStarting({ lang: null, error: "Could not start. Check your internet connection and try again." });
    throw e;
  }
}

export function Onboarding({ onStarted, signedIn }: { onStarted: (lang: string) => void; signedIn: boolean }) {
  const draft = readDraft();
  // The draft may name a language this build lacks (saved by a newer build in another tab): start from Spanish then.
  const [lang, setLang] = useState<string>(() => (draft.lang && isDeckLang(draft.lang) ? draft.lang : "es"));
  // After "Delete my account": a goodbye on the landing page, for a short
  // while (the app reloads once as the user changes), then never again.
  const [goodbye] = useState(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem("perennial-farewell") ?? "null") as { lang: string | null; at: number } | null;
      if (!saved || Date.now() - saved.at > 20_000) {
        sessionStorage.removeItem("perennial-farewell");
        return null;
      }
      return farewell(saved.lang);
    } catch {
      return null;
    }
  });
  const [linking, setLinking] = useState(false);
  const [busy, setBusy] = useState(false);
  // Shared, not local: a failed start may come back as a new copy of this page.
  const { error } = useStartingCourse();
  const [walking, setWalking] = useState(false);
  useEffect(() => saveDraft({ lang }), [lang]);
  // A deck that fails to load only leaves the showcase without its garden: starting needs no deck.
  const { deck } = useDeck(lang);
  const fresh = useMemo(() => (deck ? showcaseGarden(deck) : null), [deck]);
  // While another language's deck loads, keep showing the last garden: no gap, no jump.
  const [lastShown, setLastShown] = useState(fresh);
  if (fresh && fresh !== lastShown) setLastShown(fresh);
  const showcase = fresh ?? lastShown;
  // Load every course's deck early, so switching language is instant. A failed
  // early load is logged (loadDeck); useDeck loads the deck again when it is chosen.
  useEffect(() => {
    for (const l of COURSE_LANGUAGES) void loadDeck(l.code).catch(() => {});
  }, []);
  const name = language(lang).name;
  const walkSource = useMemo(() => (deck && walking ? showcaseWalkPlants(deck) : null), [deck, walking]);

  const start = async () => {
    setBusy(true);
    try {
      await startCourse(lang);
      track("course_started", { lang });
      onStarted(lang);
    } catch {
      // startCourse set the error (shown by whichever copy of this page is up).
      setBusy(false);
    }
  };

  if (walking) return <GardenWalk lang={lang} source={walkSource} visitors={showcaseVisitors(lang)} onExit={() => setWalking(false)} />;

  return (
    <div className="page narrow stagger landing">
      <header className="landing-top">
        <span className="wordmark">
          <SproutMark size={26} /> perennial
        </span>
        {!signedIn && (
          <button className="secondary small" onClick={() => setLinking(!linking)} aria-expanded={linking}>
            Sign in
          </button>
        )}
      </header>
      {!signedIn && linking && (
        <section className="panel landing-signin">
          <h2 style={{ marginTop: 0 }}>Sign in</h2>
          <p className="muted small">Sign in with your email. Your garden appears here after a moment.</p>
          <SignIn cta="Sign in" />
        </section>
      )}
      {goodbye && (
        <p className="farewell" role="status">
          {goodbye.line} {goodbye.wish && <em>{goodbye.wish}</em>}
        </p>
      )}
      <h1 style={{ marginTop: "2rem" }}>Grow a language, {DAILY_MINUTES} minutes a day.</h1>
      <p className="lede">
        Every word you learn grows into a plant. It grows each time you remember it. You learn the most common words first, in real sentences. Missed days do not pile up.
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

      <p className="muted small">Lessons are in English. More languages will come later.</p>
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
    </div>
  );
}
