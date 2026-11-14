// The bird (#209): in an orchard tree on its days there (#315), else on the
// hedge, a notice board, the first bed's sign or the fence's rail, a new
// place each day (#641). It hops away when you come close, and flies back to the
// same spot once you are well away. Sent somewhere else (#334: by a key; #362:
// the bench), or home again, it flies there.

import { daily } from "../../core/day";
import { BIRD, BIRD_HOP } from "../visitorArt";
import { bodyAt, there, type VisitorKind } from "./kind";

/** It hops off when you come this near (m), and back once you are this far (m). */
const SHY = 1;
const CALM = 6;
/** The hop's length (s). */
const HOP_S = 0.7;
/** Flying from one spot to another (#802): its speed (m/s), and how high over the straight line it goes, for each metre of the flight (m). */
const FLIGHT = 3;
const ARC = 0.25;

type Look = "sit" | "hop";

export const bird: VisitorKind<Look> = {
  id: "bird",
  // Two empty units under the hop: it is in the air.
  art: { sit: BIRD, hop: { ...BIRD_HOP, h: BIRD_HOP.h + 2 } },
  arrive({ spots, now, reducedMotion }) {
    const tree = spots.trees.find((t) => t.who === "bird");
    const body = tree ? bodyAt<Look>(tree.x, tree.y, tree.z, "sit") : bodyAt<Look>(...daily(spots.perches, "visitor-bird-spot", now), "sit");
    /** t: -1 sitting, 0 to 1 while hopping, 1 once gone; (dx, dz): away from you. */
    let t = -1;
    let dx = 0;
    let dz = 0;
    /** Sitting with you on the bench (#362): it does not hop off. */
    let settled = false;
    /** Flying to its spot: where from, and how far along (0 to 1); null when it is not. */
    let flight: { x: number; y: number; z: number; k: number } | null = null;
    const settle = () => {
      t = -1;
      flight = null;
      body.x = body.at.x;
      body.y = body.at.y;
      body.z = body.at.z;
      body.frame = "sit";
      body.visible = true;
    };
    /** Off to its spot from where it is drawn, in the air. With reduced motion it is just there. */
    const flyHome = () => {
      if (reducedMotion || there(body)) return settle();
      [t, flight] = [-1, { x: body.x, y: body.y, z: body.z, k: 0 }];
      body.frame = "hop";
      body.visible = true;
    };
    return {
      size: 0.5,
      body,
      step({ dt, x, z }) {
        const { at } = body;
        if (flight) {
          const len = Math.hypot(at.x - flight.x, at.y - flight.y, at.z - flight.z);
          flight.k = Math.min(1, flight.k + (FLIGHT * dt) / Math.max(len, 0.01));
          const k = flight.k;
          body.x = flight.x + (at.x - flight.x) * k;
          body.z = flight.z + (at.z - flight.z) * k;
          body.y = flight.y + (at.y - flight.y) * k + Math.sin(Math.PI * k) * ARC * len;
          if (k === 1) settle();
          return;
        }
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
        // It comes back the way it went: from up where it flew off to.
        if (t >= 1 && d > CALM) flyHome();
        return startled ? "startled" : undefined;
      },
      onVisit(s) {
        settled = s;
        // Flown off out of sight, it comes back to its new spot once you are well away (step).
        if (t >= 1) return;
        flyHome();
      },
    };
  },
};
