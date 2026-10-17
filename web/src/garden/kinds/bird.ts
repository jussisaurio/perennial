// The bird (#209): in an orchard tree on its days there (#315), on top of its
// word's plant (at its foot when the plant droops), or on a notice board or
// the fence's rail. It hops away when you come close, and comes back to the
// same spot once you are well away. Called (#377), it flies up and lands
// again where it was.

import { daily } from "../../core/day";
import { BIRD, BIRD_HOP } from "../visitorArt";
import { bodyAt, type VisitorKind } from "./kind";

/** It hops off when you come this near (m), and back once you are this far (m). */
const SHY = 1;
const CALM = 6;
/** The hop's length (s). */
const HOP_S = 0.7;
/** Called: its flight up and back down (s), and how high it goes (m). */
const FLY_S = 1.4;
const FLY_UP = 0.7;

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
    /** Called: 0 to 1 while it flies up and lands again; -1 when it is not. */
    let fly = -1;
    const settle = () => {
      t = -1;
      fly = -1;
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
        if (fly >= 0 && t < 0) {
          fly = Math.min(1, fly + dt / FLY_S);
          body.y = at.y + Math.sin(Math.PI * fly) * FLY_UP;
          body.frame = fly < 1 ? "hop" : "sit";
          if (fly === 1) fly = -1;
        }
        if (t < 0 && d < SHY && !settled) {
          fly = -1;
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
      onCall() {
        // Already off, or with reduced motion: it does not answer.
        if (t >= 0 || reducedMotion) return null;
        fly = 0;
        return { line: "The bird flies up and lands again." };
      },
    };
  },
};
