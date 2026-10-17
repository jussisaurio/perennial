// The bird (#209): in an orchard tree on its days there (#315), on top of its
// word's plant (at its foot when the plant droops), or on a notice board or
// the fence's rail. It hops away when you come close, and comes back to the
// same spot once you are well away.

import { daily } from "../../core/day";
import { BIRD, BIRD_HOP } from "../visitorArt";
import { bodyAt, type VisitorKind } from "./kind";

/** It hops off when you come this near (m), and back once you are this far (m). */
const SHY = 1;
const CALM = 6;
/** The hop's length (s). */
const HOP_S = 0.7;

type Look = "sit" | "hop";

export const bird: VisitorKind<Look> = {
  id: "bird",
  // Two empty rows under the hop: it is in the air.
  art: { sit: BIRD, hop: { ...BIRD_HOP, rows: [...BIRD_HOP.rows, "", ""] } },
  arrive({ spots, home, now, reducedMotion }) {
    const tree = spots.trees.find((t) => t.who === "bird");
    const body = tree
      ? bodyAt<Look>(tree.x, tree.y, tree.z, "sit")
      : home
        ? bodyAt<Look>(home.x, home.thirsty ? home.soil : home.top + 0.02, home.z + 0.05, "sit")
        : bodyAt<Look>(...daily(spots.perches, "visitor-bird-spot", now), "sit");
    /** t: -1 sitting, 0 to 1 while hopping, 1 once gone; (dx, dz): away from you. */
    let t = -1;
    let dx = 0;
    let dz = 0;
    /** Sitting with you on the bench (#362): it does not hop off. */
    let settled = false;
    const settle = () => {
      t = -1;
      body.x = body.at.x;
      body.y = body.at.y;
      body.z = body.at.z;
      body.frame = "sit";
      body.visible = true;
    };
    return {
      size: 0.5,
      body,
      step({ dt, x, z }) {
        const { at } = body;
        const d = Math.hypot(at.x - x, at.z - z);
        let startled = false;
        if (t < 0 && d < SHY && !settled) {
          // Away from you, a little to the side.
          const k = 1 / Math.max(d, 0.01);
          dx = (at.x - x) * k;
          dz = (at.z - z) * k;
          t = reducedMotion ? 1 : 0;
          body.frame = "hop";
          startled = true;
        }
        if (t >= 0 && t < 1) {
          t = Math.min(1, t + dt / HOP_S);
          const e = t * 2.2;
          body.x = at.x + dx * e - dz * e * 0.3;
          body.y = at.y + Math.sin(Math.min(1, t * 1.6) * Math.PI) * 0.25 + t * t * 1.6;
          body.z = at.z + dz * e + dx * e * 0.3;
        }
        if (t >= 1) body.visible = false;
        if (t >= 1 && d > CALM) settle();
        return startled ? "startled" : undefined;
      },
      onVisit(s) {
        settled = s;
        settle();
      },
    };
  },
};
