// The snail (#55, #641): on the fence's rail, doing one lap of the fence a day
// from the gate at midnight. It creeps about a millimetre a second. It is
// pinned flat on the fence like a sticker, its drawn side to the garden, so it
// never swings through the pickets as a cut-out that faces you would (#1161).

import { artEnds, SNAIL_LEFT } from "../visitorArt";
import { onFence, snailLap } from "../visitors";
import { RAIL } from "../spots";
import { bodyAt, type VisitorKind } from "./kind";

/** How often it moves along the rail (s): it creeps about a millimetre in that time. */
const CREEP_S = 0.5;
/** How far inside the fence it sits, so it is on the rail and not in it (m). */
const INSIDE = 0.06;
const SIZE = 0.7;
/** Its ends, left and right of its middle (m): its head on the left. */
const [HEAD, TAIL] = artEnds(SNAIL_LEFT.w, SIZE);
type Look = "snail";

export const snail: VisitorKind<Look> = {
  id: "snail",
  art: { snail: SNAIL_LEFT },
  stand: "fixed",
  arrive({ layout, now }) {
    const opened = now.getTime();
    /** Its middle and turn at `t`. It goes round with the garden on its right, so from inside it goes left, head first: its art's right, its tail, points back. */
    const place = (t: Date) => {
      const p = onFence(layout, INSIDE, TAIL - HEAD, snailLap(t));
      return { x: p.x + p.dx * TAIL, z: p.z + p.dz * TAIL, turn: Math.atan2(-p.dz, -p.dx) };
    };
    const at = place(now);
    const body = bodyAt<Look>(at.x, RAIL, at.z, "snail");
    body.turn = at.turn;
    let moved = 0;
    return {
      size: SIZE,
      body,
      step({ elapsed }) {
        if (elapsed - moved < CREEP_S) return;
        moved = elapsed;
        // The walk's clock, from the moment it opened: no clock read here.
        const q = place(new Date(opened + elapsed * 1000));
        body.at.x = body.x = q.x;
        body.at.z = body.z = q.z;
        body.turn = q.turn;
      },
    };
  },
};
