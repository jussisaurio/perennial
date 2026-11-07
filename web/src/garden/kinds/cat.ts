// The cat (#17, #209): asleep on the bench or on the shed's step, one or the
// other each day (#641). It opens one eye when you come near. Sent to the
// bench beside you (#362), or home again, it walks there.

import { daily } from "../../core/day";
import { CAT_ASLEEP, CAT_AWAKE, CAT_STARE } from "../visitorArt";
import { bodyAt, there, walkHome, walkOn, type VisitorKind, type Walk } from "./kind";

/** How near you come before it opens an eye (m). */
const WAKE_RANGE = 2.4;
/** It walks this fast (m/s). */
const WALK = 0.8;

type Look = "asleep" | "awake" | "stare";

export const cat: VisitorKind<Look> = {
  id: "cat",
  art: { asleep: CAT_ASLEEP, awake: CAT_AWAKE, stare: CAT_STARE },
  top: 0.45,
  arrive({ spots, ground, now, reducedMotion }) {
    /** Sitting with you on the bench (#362): it does not open an eye. */
    let settled = false;
    const [sx, sy, sz] = spots.shedStep;
    const body =
      daily(["bench", "step"] as const, "visitor-cat-spot", now) === "bench"
        ? bodyAt<Look>(spots.bench.x + 0.18, 0.45, spots.bench.z + 0.02, "asleep")
        : // At the step's far end.
          bodyAt<Look>(sx, sy, sz + 0.4, "asleep");
    /** On its way to its spot ("back"). */
    let mode: "home" | "back" = "home";
    let walk: Walk = { way: [], leg: 0, y: 0 };
    const settle = () => {
      mode = "home";
      [body.x, body.y, body.z] = [body.at.x, body.at.y, body.at.z];
    };
    return {
      size: 0.95,
      body,
      step({ dt, x, z }) {
        if (mode === "back" && walkOn(body, walk, reducedMotion ? Infinity : WALK * dt)) settle();
        if (mode !== "home") {
          body.frame = "stare";
          return;
        }
        body.frame = Math.hypot(body.at.x - x, body.at.z - z) < WAKE_RANGE && !settled ? "awake" : "asleep";
      },
      onVisit(s) {
        settled = s;
        if (there(body)) settle();
        else [mode, walk] = ["back", walkHome(ground, body)];
      },
    };
  },
};
