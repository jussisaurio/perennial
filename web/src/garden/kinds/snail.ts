// The snail (#55, #235): partway up its word's plant, or, before it had a
// plant, on the fence's rail, doing one lap of the fence a day from the gate
// at midnight. It creeps about a millimetre a second.

import { SNAIL } from "../visitorArt";
import { fencePickets, fencePoint, snailLap } from "../visitors";
import { RAIL } from "../spots";
import { bodyAt, type VisitorKind } from "./kind";

/** How often it moves along the rail (s): it creeps about a millimetre in that time. */
const CREEP_S = 0.5;
/** How far inside the fence it sits, so it is on the rail and not in it (m). */
const INSIDE = 0.06;

type Look = "snail";

export const snail: VisitorKind<Look> = {
  id: "snail",
  art: { snail: SNAIL },
  arrive({ layout, home, now }) {
    if (home) {
      // Partway up the stem, in front of it so the plant does not hide it; on the soil when the plant droops.
      const up = home.thirsty ? 0 : (home.top - home.soil) * 0.45;
      return { size: 0.62, body: bodyAt<Look>(home.x + 0.05, home.soil + up, home.z + 0.09, "snail") };
    }
    const pickets = fencePickets(layout);
    const opened = now.getTime();
    const p = fencePoint(layout, snailLap(now) * pickets);
    const body = bodyAt<Look>(p.x + p.dz * INSIDE, RAIL, p.z - p.dx * INSIDE, "snail");
    let moved = 0;
    return {
      size: 0.7,
      body,
      step({ elapsed }) {
        if (elapsed - moved < CREEP_S) return;
        moved = elapsed;
        // The walk's clock, from the moment it opened: no clock read here.
        const q = fencePoint(layout, snailLap(new Date(opened + elapsed * 1000)) * pickets);
        body.at.x = body.x = q.x + q.dz * INSIDE;
        body.at.z = body.z = q.z - q.dx * INSIDE;
      },
    };
  },
};
