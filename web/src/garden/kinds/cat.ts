// The cat (#17, #209): curled up at the foot of its word's plant, or asleep
// on the bench. It opens one eye when you come near. Called (#377), it flicks
// one ear and does nothing. About one call in 50 it gets up, walks over, sits
// at your feet and stares at you, until you walk away; then it goes back.

import { dayNumber } from "../../core/day";
import { hash32, rng } from "../../lib/seed";
import { CAT_ASLEEP, CAT_AWAKE, CAT_EAR, CAT_EAR_AWAKE, CAT_STARE } from "../visitorArt";
import { besideYou, bodyAt, moveToward, type VisitorKind } from "./kind";

/** How near you come before it opens an eye (m). */
const WAKE_RANGE = 2.4;
/** How long its ear stays flat (s). */
const EAR_S = 0.4;
/** Its rare walk over: it sits this far from you (m), walks this fast (m/s), and goes back once you are this far from it (m). */
const AT_FEET = 0.45;
const WALK = 0.8;
const LEFT = 3;

/** Whether the cat comes on the `n`-th call (from 0) of a walk opened on this day: about one in 50, the same each time. */
export function catComes(now: Date, n: number): boolean {
  // FNV alone mixes the last characters poorly (about one in 100 here): mulberry32 over it is even.
  return rng(hash32(`cat-call:${dayNumber(now)}:${n}`))() < 1 / 50;
}

type Look = "asleep" | "awake" | "ear" | "earAwake" | "stare";

export const cat: VisitorKind<Look> = {
  id: "cat",
  art: { asleep: CAT_ASLEEP, awake: CAT_AWAKE, ear: CAT_EAR, earAwake: CAT_EAR_AWAKE, stare: CAT_STARE },
  top: 0.45,
  arrive({ spots, home, now, reducedMotion }) {
    /** Sitting with you on the bench (#362): it does not open an eye. */
    let settled = false;
    const body = home ? bodyAt<Look>(home.x + 0.2, home.soil, home.z + 0.12, "asleep") : bodyAt<Look>(spots.bench.x + 0.18, 0.45, spots.bench.z + 0.02, "asleep");
    /** Its ear is flat until then (elapsed s); calls so far in this walk; on its rare walk: to you ("come"), sitting ("stare"), going back. */
    let ear = -1;
    let calls = 0;
    let mode: "home" | "come" | "stare" | "back" = "home";
    let to = { x: 0, z: 0 };
    const settle = () => {
      mode = "home";
      [body.x, body.y, body.z] = [body.at.x, body.at.y, body.at.z];
    };
    return {
      size: 0.95,
      body,
      step({ dt, elapsed, x, z }) {
        const pace = reducedMotion ? Infinity : WALK * dt;
        if (mode === "come" && moveToward(body, to.x, to.z, pace)) mode = "stare";
        else if (mode === "stare" && Math.hypot(body.x - x, body.z - z) > LEFT) mode = "back";
        else if (mode === "back" && moveToward(body, body.at.x, body.at.z, pace)) settle();
        if (mode !== "home") {
          body.frame = "stare";
          return;
        }
        const awake = Math.hypot(body.at.x - x, body.at.z - z) < WAKE_RANGE && !settled;
        const flat = elapsed < ear;
        body.frame = awake ? (flat ? "earAwake" : "awake") : flat ? "ear" : "asleep";
      },
      onVisit(s) {
        settled = s;
        settle();
      },
      onCall({ elapsed, x, z }) {
        if (mode !== "home") return { line: "The cat stares at you." };
        if (!catComes(now, calls++)) {
          ear = elapsed + EAR_S;
          return { line: "The cat flicks one ear." };
        }
        to = besideYou(body, x, z, AT_FEET);
        mode = "come";
        return { line: "The cat gets up, walks over, sits at your feet and stares at you." };
      },
    };
  },
};
