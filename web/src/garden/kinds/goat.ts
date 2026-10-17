// The goat in impossible places (#376, #335 G1): on its rare days it stands
// somewhere no goat could get, chosen by the date: on top of the hedge, on the
// shed's roof, on a notice board, on the back of the bench. Once you have seen
// it, look away and look back: it is gone. It leaves only while out of view,
// and never says how it got there.

import { daily } from "../../core/day";
import type { Ledge } from "../spots";
import { GOAT } from "../visitorArt";
import { bodyAt, type VisitorKind } from "./kind";

/** Out of view this long (s) after you saw it, and it has gone. */
export const GOAT_GONE = 1;
/** Its name shows, and a screen reader hears where it stands, while you are this near (m): it stands high up, so further than most. */
const GOAT_NEAR = 4;

/** Where it stands, as a screen reader hears it. */
const STANDS: Record<Ledge["on"], string> = {
  hedge: "A goat stands on top of the hedge.",
  shed: "A goat stands on the roof of the shed.",
  sign: "A goat stands on top of the sign.",
  bench: "A goat stands on the back of the bench.",
};

type Look = "goat";

export const goat: VisitorKind<Look> = {
  id: "goat",
  art: { goat: GOAT },
  hit: [0.3, 0.38, 0.3],
  top: 0.62,
  tagRange: GOAT_NEAR,
  arrive({ spots, now }) {
    const ledge = daily(spots.ledges, "visitor-goat-ledge", now);
    const body = bodyAt<Look>(...ledge.at, "goat");
    /** You have seen it; and since when (elapsed s) it has been out of view, or -1 while in view. */
    let met = false;
    let away = -1;
    return {
      size: 1,
      body,
      step({ elapsed, x, z }, seen) {
        if (!body.visible) return;
        if (seen) {
          met = true;
          away = -1;
        } else if (met && away < 0) away = elapsed;
        if (away >= 0 && elapsed - away >= GOAT_GONE) {
          body.visible = false;
          body.status = null;
          return;
        }
        body.status = Math.hypot(body.at.x - x, body.at.z - z) < GOAT_NEAR ? STANDS[ledge.on] : null;
      },
      // A call (#377): it does not move. It never explains itself.
      onCall: () => ({ line: "The goat looks down at you, chewing." }),
    };
  },
};
