import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { aiMode, type AIMode } from "../ai/backend";
import { SignIn, useAccount } from "./Account";
import { hostedMessage } from "../hosted/api";
import { ensurePool, freshLexemes, frequencyList } from "../content/builder";
import { language } from "../content/languages";
import { db } from "../db/db";
import type { Course } from "../model";
import { Garden } from "./Garden";
import { FlowerIcon, SeedIcon } from "./icons";
import { courseStats } from "./stats";

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Hello" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// The entrance animation plays once per visit, not on every tab switch.
let animated = false;

export function Home({ course, onStart, onAddWords, onWalk }: { course: Course; onStart: (minutes: number) => void; onAddWords: () => void; onWalk: () => void }) {
  const [stagger] = useState(() => !animated);
  useEffect(() => {
    animated = true;
  }, []);
  const { signedIn } = useAccount();
  const [mode, setMode] = useState<AIMode | null | undefined>(undefined);
  useEffect(() => {
    void aiMode().then(setMode);
  }, [signedIn]);
  const stats = useLiveQuery(() => courseStats(course.id, course.lang), [course.id, course.lang]);
  const ready = useLiveQuery(async () => (await freshLexemes(course.id)).length, [course.id]);
  const started = useLiveQuery(() => db.memory.where("courseId").equals(course.id).count(), [course.id]);
  const [prep, setPrep] = useState<string | null>(null);

  // Keep a pool of words generated ahead of time.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Needed for the coverage estimate even on devices without AI.
      void frequencyList(course.lang).catch(() => {});
      if (!(await aiMode())) return;
      setPrep("Preparing new words…");
      try {
        await ensurePool(course);
        if (!cancelled) setPrep(null);
      } catch (e) {
        if (!cancelled) setPrep(`Could not prepare new words: ${hostedMessage(e)}`);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course.id, signedIn]);

  const canStart = (ready ?? 0) > 0 || (started ?? 0) > 0;
  const doneToday = !!stats && stats.minutesToday >= course.minutes;
  // Picked up partway through the day: offer the rest, not the full session again.
  const left = stats ? Math.max(0, Math.round(course.minutes - stats.minutesToday)) : course.minutes;
  const partial = !!stats && stats.minutesToday >= 0.5 && !doneToday;
  const sessionMinutes = doneToday ? 5 : partial ? Math.max(2, left) : course.minutes;
  const max = Math.max(1, ...(stats?.days.map((d) => d.reviews) ?? [1]));
  const lang = language(course.lang).name;

  return (
    <div className={stagger ? "page home stagger" : "page home"}>
      <header className="home-head">
        <div>
          <div className="date">{new Date().toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}</div>
          <h1>
            {greeting()}. Time for <em>{lang}</em>.
          </h1>
        </div>
      </header>

      <Garden courseId={course.id} />
      <button className="walk-link" onClick={onWalk}>
        <FlowerIcon size={18} /> Walk in your garden
      </button>

      {!canStart && !prep && mode === null && (
        // Nothing to learn yet and no AI: offer the two real ways forward.
        <div className="panel form empty-start">
          <strong>There are no words to learn yet.</strong>
          <p className="muted small">Perennial AI prepares the most common words for you, with example sentences and audio. It is free to start.</p>
          <SignIn cta="Get free words with my email" />
          <div className="row">
            <span className="muted small">Or without AI:</span>
            <button className="secondary" onClick={onAddWords}>
              Type my own words
            </button>
          </div>
        </div>
      )}

      <div className="start-row">
        <button className="start" disabled={!canStart} onClick={() => onStart(sessionMinutes)}>
          <span className="clock" aria-hidden="true">
            <SeedIcon size={20} />
          </span>
          {doneToday ? "Practice more" : partial ? "Finish today's session" : "Start today's session"}
          <small>{sessionMinutes} min</small>
        </button>
        <p className="start-note">
          {!canStart
            ? prep ?? (mode === null ? "" : "Preparing your first words…")
            : prep ??
              (started === 0
                ? `${ready} new words are ready. Each word has example sentences and audio.`
                : doneToday
                  ? "You did your minutes for today. More practice is a bonus."
                  : partial
                    ? ""
                    : "Missed days do not pile up. We choose the most useful practice for your time.")}
        </p>
      </div>

      {stats && stats.known + stats.learning > 0 && (
        <div className="progress-line">
          {stats.known > 0 ? (
            <p>
              You know <strong>{stats.known}</strong> {stats.known === 1 ? "word" : "words"}.
              {stats.coverage !== null && stats.coverage >= 0.01 && (
                <>
                  {" "}
                  They make up about <strong>{Math.round(stats.coverage * 100)}%</strong> of the words people use in everyday {lang}.
                </>
              )}
            </p>
          ) : (
            <p>
              You are learning <strong>{stats.learning}</strong> {stats.learning === 1 ? "word" : "words"}.
            </p>
          )}
          <details className="more">
            <summary>What does "know" mean?</summary>
            <p className="muted small">
              A word counts as known when you remembered it at least twice and you will most likely still remember it a week from now. The percentage counts how often these words appear in film and TV subtitles. Common words like "the" count a lot, so the number grows fast at first.
            </p>
          </details>
        </div>
      )}

      {stats && stats.days.some((d) => d.reviews) && (
        <details className="more">
          <summary>More progress</summary>
          <div className="stats">
            <div className="stat">
              <div className="num">{stats.learning}</div>
              <div className="lbl">learning</div>
            </div>
            <div className="stat">
              <div className="num">{stats.retention30 !== null ? `${Math.round(stats.retention30 * 100)}%` : "—"}</div>
              <div className="lbl">recall rate, last 30 days (target {Math.round(course.retention * 100)}%)</div>
            </div>
          </div>
          <p className="muted small">Recall rate: how often you remembered a word when it came back on a later day. It needs at least 20 such answers.</p>
          <div className="activity" role="img" aria-label="Reviews per day, last 30 days">
            {stats.days.map((d, i) => (
              <div key={d.day} className={i === 29 ? "today" : undefined} title={`${new Date(d.day).toLocaleDateString("en", { month: "short", day: "numeric" })}: ${d.reviews} reviews`} style={{ height: `${Math.max(4, (d.reviews / max) * 100)}%` }} />
            ))}
          </div>
          <div className="activity-cap">
            <span>30 days ago</span>
            <span>today</span>
          </div>
        </details>
      )}
    </div>
  );
}
