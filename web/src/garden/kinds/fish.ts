// The fish (#209): in the pond, whatever its plant, just under the lily pads.
// It swims one slow circle, head first. With reduced motion it stays where it
// is.

import { KOI } from "../visitorArt";
import { bodyAt, type VisitorKind } from "./kind";

/** Its circle, as a fraction of the pond's radius (it passes under the lily pads), and its speed (rad/s). */
const CIRCLE = 0.45;
const SPEED = 0.2;

type Look = "fish";

export const fish: VisitorKind<Look> = {
  id: "fish",
  art: { fish: KOI },
  hit: [0, 0.3, 0.2],
  top: 0.2,
  lying: true,
  arrive({ layout, reducedMotion }) {
    const { pond } = layout;
    const r = pond.r * CIRCLE;
    const body = bodyAt<Look>(pond.x + r, 0.05, pond.z, "fish");
    let a = 0;
    body.turn = a + Math.PI / 2;
    return {
      size: 0.68,
      body,
      step({ dt }) {
        if (reducedMotion) return;
        a += dt * SPEED;
        body.at.x = body.x = pond.x + Math.cos(a) * r;
        body.at.z = body.z = pond.z + Math.sin(a) * r;
        body.turn = a + Math.PI / 2;
      },
    };
  },
};
