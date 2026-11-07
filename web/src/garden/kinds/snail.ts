// The snail (#55, #641): on the fence's rail, doing one lap of the fence a day
// from the gate at midnight. It creeps about a millimetre a second. Called (#377), it pulls
// into its shell, three full seconds later, and comes out again after a while.

import { SNAIL, SNAIL_SHELL } from "../visitorArt";
import { fencePickets, fencePoint, snailLap } from "../visitors";
import { RAIL } from "../spots";
import { bodyAt, type Body, type Visitor, type VisitorKind } from "./kind";

/** How often it moves along the rail (s): it creeps about a millimetre in that time. */
const CREEP_S = 0.5;
/** How far inside the fence it sits, so it is on the rail and not in it (m). */
const INSIDE = 0.06;
/** Called: how long it takes to hear you (s), and how long it stays in its shell (s). */
const SLOW_S = 3;
const SHELL_S = 5;

type Look = "snail" | "shell";

/** A snail at `body`, creeping along the rail with `creep`, that hides in its shell when called. */
function snailAt(body: Body<Look>, creep: (elapsed: number) => void): Visitor<Look> {
  /** In its shell from then (elapsed s), for SHELL_S; -1 when it was not called. */
  let hide = -1;
  return {
    size: 0.7,
    body,
    step({ elapsed }) {
      creep(elapsed);
      if (hide < 0) return;
      body.frame = elapsed >= hide && elapsed < hide + SHELL_S ? "shell" : "snail";
      if (elapsed >= hide + SHELL_S) hide = -1;
    },
    onCall({ elapsed }) {
      // Called again while it waits or hides: it is already busy hiding.
      if (hide < 0) hide = elapsed + SLOW_S;
      return { line: "The snail hears you. Slowly, it goes into its shell." };
    },
  };
}

export const snail: VisitorKind<Look> = {
  id: "snail",
  art: { snail: SNAIL, shell: SNAIL_SHELL },
  arrive({ layout, now }) {
    const pickets = fencePickets(layout);
    const opened = now.getTime();
    const p = fencePoint(layout, snailLap(now) * pickets);
    const body = bodyAt<Look>(p.x + p.dz * INSIDE, RAIL, p.z - p.dx * INSIDE, "snail");
    let moved = 0;
    return snailAt(body, (elapsed) => {
      if (elapsed - moved < CREEP_S) return;
      moved = elapsed;
      // The walk's clock, from the moment it opened: no clock read here.
      const q = fencePoint(layout, snailLap(new Date(opened + elapsed * 1000)) * pickets);
      body.at.x = body.x = q.x + q.dz * INSIDE;
      body.at.z = body.z = q.z - q.dx * INSIDE;
    });
  },
};
