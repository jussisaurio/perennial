// The cat (#17, #209): curled up at the foot of its word's plant, or asleep
// on the bench. It opens one eye when you come near.

import { CAT_ASLEEP, CAT_AWAKE } from "../visitorArt";
import { bodyAt, type VisitorKind } from "./kind";

/** How near you come before it opens an eye (m). */
const WAKE_RANGE = 2.4;

type Look = "asleep" | "awake";

export const cat: VisitorKind<Look> = {
  id: "cat",
  art: { asleep: CAT_ASLEEP, awake: CAT_AWAKE },
  top: 0.45,
  arrive({ spots, home }) {
    /** Sitting with you on the bench (#362): it does not open an eye. */
    let settled = false;
    const body = home ? bodyAt<Look>(home.x + 0.2, home.soil, home.z + 0.12, "asleep") : bodyAt<Look>(spots.bench.x + 0.18, 0.45, spots.bench.z + 0.02, "asleep");
    return {
      size: 0.95,
      body,
      step({ x, z }) {
        body.frame = Math.hypot(body.at.x - x, body.at.z - z) < WAKE_RANGE && !settled ? "awake" : "asleep";
      },
      onVisit(s) {
        settled = s;
      },
    };
  },
};
