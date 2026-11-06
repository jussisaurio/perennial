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
import { chunkLabel, DAILY_MINUTES, nextChunk, sessionPlan } from "../data/practice";
import { mayListen } from "./speech";
import { Settling } from "./Settling";
import { doneTodayNote, greetingAside } from "../content/voice";
import { plural } from "./format";
import { focusBowl, focusPlant } from "./gardenFocus";
import { learnerVisitors, waitingGuest } from "./visitors";
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
  const chunk = useMemo(() => (learner ? nextChunk(learner, now) : null), [learner, now]);
  // The same planner the session uses, for what the day's minutes are for.
  const plan = useMemo(() => (learner && chunk ? sessionPlan(learner, chunk.minutes, mayListen(language(code).tag), now) : null), [learner, chunk, now, code]);
  const visitors = useMemo(() => (learner ? learnerVisitors(learner) : null), [learner, day]); // eslint-disable-line react-hooks/exhaustive-deps -- per day, not per minute
  // What waits in the walk (#335): it shows until it is found, whether or not today's practice is done.
  const guest = useMemo(() => (learner ? waitingGuest(learner, now) : null), [learner, day]); // eslint-disable-line react-hooks/exhaustive-deps -- per day, not per minute
  const waiting = guest && {
    guest,
    onOpen: () => {
      focusBowl();
      onWalk();
    },
  };
  // Where the snail is on its daily lap (the strip is the fence, unrolled).
  const snailAt = snailLap();
  // On the day a milestone is crossed, or after a break, one quiet line instead of the usual aside.
  const aside = visitors?.milestone ?? visitors?.welcome ?? greetingAside();
  if (!learner || !stats || !chunk || !plan) return <Settling />;
  const course = learner.course;
  const ready = stats.seeds;
  const started = stats.known + stats.learning;
  const start = () => onStart(chunk.minutes);
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

      {/* The day's action right under the greeting: on a phone it must never sit under the tab bar. */}
      <div className="start-row">
        {/* Watered only once nothing is due: with 5 minutes a day, a big garden can still have thirsty plants. */}
        {chunk.state === "done" && <p className="watered">{plan.due ? `${plural(plan.due, "plant")} still ${plan.due === 1 ? "needs" : "need"} water.` : "The garden is watered for today."}</p>}
        <Shortcut keyName="Enter" run={start} />
        <button className="start" onClick={start} aria-keyshortcuts="Enter">
          <span className="clock" aria-hidden="true">
            <SeedIcon size={20} />
          </span>
          {chunkLabel(chunk)}
        </button>
        <p className="start-note">
          {chunk.state === "done"
            ? plan.due
              ? "" // no wink under a count of thirsty plants: it would read as if all is well
              : doneTodayNote()
            : started === 0
              ? `${ready} seeds are ready to plant: the most common words first, and a few garden words early. Each word has example sentences and audio.`
              : ready === 0
                ? "Every seed in the course is planted. Today is for growing them."
                : plan.due === 0
                  ? "Every plant has water. Today is for new seeds."
                  : plan.newCount > 2
                  ? "Water your plants, then plant a few new seeds."
                  : "Today is mostly watering. Missed days do not pile up."}
        </p>
        {user && course.minutes !== DAILY_MINUTES && <FiveMinutesNote userId={user.id} />}
      </div>

      <Garden data={garden} onView={view} visitors={visitors && { views: visitors.views, snailAt, lang: code, mole: visitors.mole }} waiting={waiting} />
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

    </div>
  );
}

/**
 * For learners who chose another daily length before it was 5 minutes for everyone
 * (`course.minutes`): what changed, said once per user on this device.
 */
function FiveMinutesNote({ userId }: { userId: string }) {
  const key = `perennial-five-minutes-note:${userId}`;
  const [show] = useState(() => {
    try {
      return localStorage.getItem(key) === null;
    } catch {
      return false; // storage blocked: a once-only note cannot know it was shown, so skip it
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, "seen");
    } catch {
      /* storage blocked: see above */
    }
  }, [key]);
  if (!show) return null;
  return <p className="muted small five-minutes-note">Perennial is now 5 minutes at a time. Practice more whenever you like: your plants will drink it up.</p>;
}

/** Enter starts the session. */
function Shortcut({ keyName, run }: { keyName: string; run: () => void }) {
  useShortcut(keyName, run);
  return null;
}
