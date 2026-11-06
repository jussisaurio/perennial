import { startTransition, useDeferredValue, useEffect, useState } from "react";
import { language } from "../content/languages";
import { useUser } from "../data/auth";
import { perLearnerDay, slicedPerLearnerDay, useLearner, type Learner } from "../data/learner";
import { SignIn } from "./Account";
import { Garden, gardenSteps } from "./Garden";
import { FlowerIcon, SeedIcon } from "./icons";
import { statsToday } from "./stats";
import { useNow } from "./useNow";
import { useShortcut } from "./useShortcut";
import { chunkLabel, DAILY_MINUTES, nextChunk, sessionPlan } from "../data/practice";
import { mayListen } from "./speech";
import { Settling } from "./Settling";
import { doneTodayNote, greetingAside } from "../content/voice";
import { longDay, plural } from "./format";
import { focusBowl, focusPlant } from "./gardenFocus";
import { learnerVisitors, waitingGuest } from "./visitors";
import { snailLap } from "../garden/visitors";
import type { Plan } from "../core/session";
import { yieldToBrowser } from "../lib/yield";

function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? "Hello" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// The entrance animation plays once per visit, not on every tab switch.
let animated = false;

// Today's garden, visitors and plan: each worked out once per learner and day, whichever part asks first.
const gardenToday = slicedPerLearnerDay(gardenSteps);
const visitorsToday = perLearnerDay((l, now) => learnerVisitors(l, new Date(now)));
// What waits in the walk (#335): it shows until it is found, whether or not today's practice is done.
const guestToday = perLearnerDay(waitingGuest);
const chunkToday = perLearnerDay(nextChunk);
// The same planner the session uses, for what the day's minutes are for. One per
// voice setting: sound can be turned off, and voices load late.
const planToday = {
  listen: perLearnerDay((l, now) => sessionPlan(l, chunkToday(l, now).minutes, true, now)),
  quiet: perLearnerDay((l, now) => sessionPlan(l, chunkToday(l, now).minutes, false, now)),
};
const voiceOf = (l: Learner) => (mayListen(language(l.lang).tag) ? "listen" : "quiet");

/**
 * The parts after the first paint, worked out before they render: the first
 * upcoming() and the plan each in a task of their own, the garden in slices.
 * In a render, React could not split them (#569). It stops once `l` is no
 * longer the current learner (see slicedPerLearnerDay).
 */
async function workOut(l: Learner, now: number, live: () => boolean) {
  l.fresh();
  await yieldToBrowser();
  if (!live()) return;
  planToday[voiceOf(l)](l, now);
  await yieldToBrowser();
  if (!live()) return;
  await gardenToday.warm(l, now, live);
}

// Each part below works out its own numbers, so on a slow device React can
// pause between the parts (App opens screens in a transition) instead of
// working them all out in one long task. The learner store updates React at
// once (useSyncExternalStore), so a new learner, as on a cold load, is
// deferred to get the same pauses.
export function Home({ lang: code, onStart, onWalk }: { lang: string; onStart: (minutes: number) => void; onWalk: () => void }) {
  const [stagger] = useState(() => !animated);
  useEffect(() => {
    animated = true;
  }, []);
  const learner = useDeferredValue(useLearner(code));
  const now = useNow();
  const rest = useAfterPaint(learner, now);
  if (!learner) return <Settling />;
  const chunk = chunkToday(learner, now);
  const lang = language(code).name;

  return (
    <div className={stagger ? "page home stagger" : "page home"}>
      <header className="home-head">
        <div>
          <div className="date">{longDay(new Date(now))}</div>
          <h1>
            {greeting()}. Time for <em>{lang}</em>.
          </h1>
          {rest && <Aside learner={learner} now={now} />}
        </div>
      </header>

      <StartRow learner={learner} chunk={chunk} now={now} rest={rest} onStart={() => onStart(chunk.minutes)} />
      {rest ? <TodayGarden learner={learner} now={now} onWalk={onWalk} /> : <Garden data={null} />}
      <button className="walk-link" onClick={onWalk}>
        <FlowerIcon size={18} /> Walk in your garden
      </button>
      {rest && <KeepGarden learner={learner} now={now} />}
    </div>
  );
}

// Whether Today's first paint has happened, on this page load.
let painted = false;

/**
 * Today's first paint is the greeting and the start button. The rest (the
 * plan's notes, the visitors, the garden, the stats) comes in the frames
 * after (workOut), then render in a transition: on a cold load at CPU 10× it
 * was 300 ms of work before anything showed (#486). Later visits have it
 * worked out already (perLearnerDay), so they draw it all at once.
 */
function useAfterPaint(learner: Learner | null, now: number): boolean {
  const [rest, setRest] = useState(painted);
  useEffect(() => {
    if (!learner || rest) return;
    let gone = false;
    // The frame's callback runs before its paint; the task after it, after the paint.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() =>
        void workOut(learner, now, () => !gone).then(() => {
          if (gone) return;
          startTransition(() => {
            painted = true;
            setRest(true);
          });
        }),
      );
    });
    return () => {
      gone = true;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [learner, now, rest]);
  return rest;
}

/** On the day a milestone is crossed, or after a break, one quiet line instead of the usual aside. */
function Aside({ learner, now }: { learner: Learner; now: number }) {
  const visitors = visitorsToday(learner, now);
  const aside = visitors.milestone ?? visitors.welcome ?? greetingAside();
  return aside && <p className="greeting-aside">{aside}</p>;
}

/** The day's action right under the greeting: on a phone it must never sit under the tab bar. */
function StartRow({ learner, chunk, now, rest, onStart }: { learner: Learner; chunk: ReturnType<typeof nextChunk>; now: number; rest: boolean; onStart: () => void }) {
  const { user } = useUser();
  const plan = rest ? planToday[voiceOf(learner)](learner, now) : null;
  return (
    <div className="start-row">
      {/* Watered only once nothing is due: with 5 minutes a day, a big garden can still have thirsty plants. Until the plan is in, an empty line keeps the button where it will be. */}
      {chunk.state === "done" && <p className="watered">{!plan ? " " : plan.due ? `${plural(plan.due, "plant")} still ${plan.due === 1 ? "needs" : "need"} water.` : "The garden is watered for today."}</p>}
      <Shortcut keyName="Enter" run={onStart} />
      <button className="start" onClick={onStart} aria-keyshortcuts="Enter">
        <span className="clock" aria-hidden="true">
          <SeedIcon size={20} />
        </span>
        {chunkLabel(chunk)}
      </button>
      {plan && <StartNote learner={learner} chunk={chunk} plan={plan} now={now} />}
      {user && learner.course.minutes !== DAILY_MINUTES && <FiveMinutesNote userId={user.id} />}
    </div>
  );
}

function StartNote({ learner, chunk, plan, now }: { learner: Learner; chunk: ReturnType<typeof nextChunk>; plan: Plan; now: number }) {
  const stats = statsToday(learner, now);
  const ready = stats.seeds;
  const started = stats.known + stats.learning;
  return (
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
  );
}

function TodayGarden({ learner, now, onWalk }: { learner: Learner; now: number; onWalk: () => void }) {
  const view = (id: string) => {
    focusPlant(id);
    onWalk();
  };
  const garden = gardenToday.get(learner, now);
  const visitors = visitorsToday(learner, now);
  const guest = guestToday(learner, now);
  const waiting = guest && {
    guest,
    onOpen: () => {
      focusBowl();
      onWalk();
    },
  };
  // Where the snail is on its daily lap (the strip is the fence, unrolled).
  const snailAt = snailLap();
  return <Garden data={garden} onView={view} visitors={{ views: visitors.views, snailAt, lang: learner.lang, mole: visitors.mole }} waiting={waiting} />;
}

/** A gentle nudge once there is something worth keeping. */
function KeepGarden({ learner, now }: { learner: Learner; now: number }) {
  const { user } = useUser();
  const stats = statsToday(learner, now);
  if (!user?.anonymous || stats.known + stats.learning < 10) return null;
  return (
    <details className="panel more keep-garden">
      <summary>Keep your garden safe: sign in with your email</summary>
      <p className="muted small">Your garden is saved in this browser. Sign in with your email to keep it in your account and on all your devices. If you have no account yet, this makes one.</p>
      <SignIn cta="Send me a code" />
    </details>
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
