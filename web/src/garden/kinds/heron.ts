// The heron, one day a month: on the stones at the pond's edge, a little
// round from the frog's pad, looking at it. It takes one slow step back when
// you come close, and steps home once you are well away. With reduced motion
// it just stays.

import { HERON, HERON_STEP } from "../visitorArt";
import { padByGate } from "../spots";
import { collide } from "../world";
import { bodyAt, type VisitorKind } from "./kind";

/** It steps back when you come this near (m), and home when you are this far (m). */
const SHY = 1.5;
const CALM = 4;
/** One step: how far (m) and how long (s). */
const STEP_M = 0.5;
const STEP_S = 1.4;

type Look = "stand" | "step";

export const heron: VisitorKind<Look> = {
  id: "heron",
  art: { stand: HERON, step: HERON_STEP },
  hit: [0.44, 0.22, 0.44],
  top: 0.92,
  tagRange: 2.5,
  arrive({ spots, layout, reducedMotion }) {
    const pad = padByGate(spots, layout);
    const { pond } = layout;
    const a = Math.atan2(pad[1] - pond.z, pad[0] - pond.x) - 0.6;
    const body = bodyAt<Look>(pond.x + Math.cos(a) * (pond.r + 0.12), 0, pond.z + Math.sin(a) * (pond.r + 0.12), "stand");
    /** t: 0 at home, 1 one step back; dir: +1 stepping back, -1 stepping home; (tx, tz): where the step goes. */
    let t = 0;
    let dir = 0;
    let tx = 0;
    let tz = 0;
    return {
      size: 1.05,
      body,
      step({ dt, x, z }) {
        if (reducedMotion) return;
        const { at } = body;
        const d = Math.hypot(at.x - x, at.z - z);
        if (dir === 0 && t === 0 && d < SHY) {
          const k = STEP_M / Math.max(d, 0.01);
          ({ x: tx, z: tz } = collide(layout, at.x + (at.x - x) * k, at.z + (at.z - z) * k, 0.12));
          dir = 1;
        } else if (dir === 0 && t === 1 && d > CALM) dir = -1;
        if (dir === 0) return;
        t = Math.max(0, Math.min(1, t + (dir * dt) / STEP_S));
        const e = t * t * (3 - 2 * t);
        body.x = at.x + (tx - at.x) * e;
        body.z = at.z + (tz - at.z) * e;
        body.frame = t > 0.15 && t < 0.85 ? "step" : "stand";
        if (t === 0 || t === 1) dir = 0;
      },
    };
  },
};
