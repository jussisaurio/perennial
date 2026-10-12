import { useEffect, useMemo, useState } from "react";
import { language } from "../content/languages";
import { useUser } from "../data/auth";
import { useLearner } from "../data/learner";
import { SignIn } from "./Account";
import { Garden, gardenFromLearner } from "./Garden";
import { FlowerIcon, SeedIcon } from "./icons";
import { courseStats } from "./stats";
import { useNow } from "./useNow";
import { useShortcut } from "./useShortcut";
import { canPractise } from "../data/practice";
import { mayListen } from "./speech";
import { Settling } from "./Settling";
import { doneTodayNote, greetingAside, restDayLine, startNote } from "../content/voice";
import { plural } from "./format";
import { focusPlant } from "./gardenFocus";
import { learnerVisitors } from "./visitors";
import { snailLap } from "../garden/visitors";
import { today } from "../core/day";

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Hello" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// The entrance animation plays once per visit, not on every tab switch.
let animated = false;

export function Home({ lang: code, onStart, onWalk }: { lang: string; onStart: (minutes: number) => void; onWalk: () => void }) {
  const view = (id: string) => {
    focusPlant(id);
    onWalk();
  };
  const [stagger] = useState(() => !animated);
  useEffect(() => {
    animated = true;
  }, []);
  const { user } = useUser();
  const learner = useLearner(code);
  const now = useNow();
  // Today's numbers and visitors change with the calendar day, not every minute.
  const day = today(new Date(now));
  const stats = useMemo(() => (learner ? courseStats(learner, now) : undefined), [learner, day]); // eslint-disable-line react-hooks/exhaustive-deps -- per day, not per minute
  const garden = useMemo(() => (learner ? gardenFromLearner(learner) : null), [learner]);
  // The same planner the session uses: is there anything to practise right now?
  // Only not when there are no words at all (every word paused or ignored).
  const canStart = useMemo(() => (learner ? canPractise(learner, mayListen(language(code).tag), now) : false), [learner, now, code]);
  const visitors = useMemo(() => (learner ? learnerVisitors(learner) : null), [learner, day]); // eslint-disable-line react-hooks/exhaustive-deps -- per day, not per minute
  // Where the snail is on its daily lap (the strip is the fence, unrolled).
  const snailAt = snailLap();
  // On the day a milestone is crossed, or after a break, one quiet line instead of the usual aside.
  const aside = visitors?.milestone ?? visitors?.welcome ?? greetingAside();
  if (!learner || !stats) return <Settling />;
  const course = learner.course;
  const ready = stats.seeds;
  const started = stats.known + stats.learning;
  const doneToday = stats.minutesToday >= course.minutes;
  // Picked up partway through the day: offer the rest, not the full session again.
  const left = Math.max(0, Math.round(course.minutes - stats.minutesToday));
  const partial = stats.minutesToday >= 0.5 && !doneToday;
  const sessionMinutes = doneToday ? 5 : partial ? Math.max(2, left) : course.minutes;
  const max = Math.max(1, ...stats.days.map((d) => d.reviews));
  const lang = language(code).name;

  return (
    <div className={stagger ? "page home stagger" : "page home"}>
      <header className="home-head">
        <div>
          <div className="date">{new Date(now).toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" })}</div>
          <h1>
            {greeting()}. Time for <em>{lang}</em>.
          </h1>
          {aside && <p className="greeting-aside">{aside}</p>}
        </div>
      </header>

      <Garden data={garden} onView={view} visitors={visitors && { views: visitors.views, snailAt, lang: code, mole: visitors.mole }} />
      <button className="walk-link" onClick={onWalk}>
        <FlowerIcon size={18} /> Walk in your garden
      </button>

      {user?.anonymous && started >= 10 && (
        // A gentle nudge once there is something worth keeping.
        <details className="panel more keep-garden">
          <summary>Keep your garden safe: add your email</summary>
          <p className="muted small">Your garden is saved in this browser. With your email, it is also kept in your account and on all your devices.</p>
          <SignIn cta="Send me a code" />
        </details>
      )}

      <div className="start-row">
        {canStart && <Shortcut keyName="Enter" run={() => onStart(sessionMinutes)} />}
        <button className="start" disabled={!canStart} onClick={() => onStart(sessionMinutes)} aria-keyshortcuts="Enter">
          <span className="clock" aria-hidden="true">
            <SeedIcon size={20} />
          </span>
          {!canStart ? "All done for today" : doneToday ? "Practice more" : partial ? "Finish today's session" : "Start today's session"}
          {canStart && <small>{sessionMinutes} min</small>}
        </button>
        <p className="start-note">
          {!canStart
            ? ready === 0
              ? "You have learned every word in the course. Add words from your own texts to keep growing."
              : "Every word that needs practice has had it, and today's new words are planted."
            : started === 0
              ? `${ready} words are ready, most common first. Each word has example sentences and audio.`
              : doneToday
                ? doneTodayNote()
                : partial
                  ? ""
                  : startNote()}
        </p>
      </div>

      {started > 0 && (
        <div className="progress-line">
          {stats.known > 0 ? (
            <p>
              You know <strong>{stats.known}</strong> {stats.known === 1 ? "word" : "words"} of {lang}, most common first.
            </p>
          ) : (
            <p>
              You are learning <strong>{stats.learning}</strong> {stats.learning === 1 ? "word" : "words"}.
            </p>
          )}
          <details className="more">
            <summary>What does "know" mean?</summary>
            <p className="muted small">
              A word counts as known when you remembered it at least twice and you will most likely still remember it a week from now. The course starts with the words people use most in everyday speech, so each word you learn is one you will hear often.
            </p>
          </details>
        </div>
      )}

      {stats.days.some((d) => d.reviews) && (
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
              <div key={d.day} className={i === 29 ? "today" : undefined} title={d.reviews ? `${new Date(d.day).toLocaleDateString("en", { month: "short", day: "numeric" })}: ${plural(d.reviews, "review")}` : restDayLine(new Date(d.day).toLocaleDateString("en", { month: "short", day: "numeric" }))} style={{ height: `${Math.max(4, (d.reviews / max) * 100)}%` }} />
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

/** Enter starts the session (only while it can start). */
function Shortcut({ keyName, run }: { keyName: string; run: () => void }) {
  useShortcut(keyName, run);
  return null;
}
