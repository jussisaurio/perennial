// The dog (#209): sitting by the shed (#641), and wagging its tail while you
// are near. With reduced motion it just sits. Sent to wait somewhere else (#334: by a key), or home again, it trots
// there, round whatever is in the way (#761). With reduced motion it is just there.

import { DOG, DOG_WAG } from "../visitorArt";
import { bodyAt, there, walkHome, walkOn, type VisitorKind, type Walk } from "./kind";

/** How long each frame of the wag shows (s), and how near you come before it wags (m). */
const WAG_S = 0.3;
const WAG_RANGE = 2.4;
/** It trots to its place at this speed (m/s). */
const TROT = 1.4;
/** Sent somewhere else from its place (#802: home from the key you just picked up), it stays this long first (s), wagging. */
const LINGER_S = 2.5;

type Look = "sit" | "wag";

export const dog: VisitorKind<Look> = {
  id: "dog",
  art: { sit: DOG, wag: DOG_WAG },
  hit: [0.25, 0.3, 0.27],
  arrive({ spots, ground, reducedMotion }) {
    // On the ground a little out from the step.
    const [sx, , sz] = spots.shedStep;
    const body = bodyAt<Look>(sx - 0.9, 0, sz - 0.2, "sit");
    /** Sent somewhere: staying a moment where it is until `until` (elapsed s), then trotting there ("back"). */
    let mode: "home" | "stay" | "back" = "home";
    let walk: Walk = { way: [], leg: 0, y: 0 };
    let until = 0;
    const settle = () => {
      mode = "home";
      [body.x, body.y, body.z] = [body.at.x, body.at.y, body.at.z];
    };
    return {
      size: 0.7,
      body,
      step({ dt, elapsed, x, z }) {
        const wag = !reducedMotion && Math.floor(elapsed / WAG_S) % 2 === 1;
        if (mode === "stay" && elapsed > until) [mode, walk] = ["back", walkHome(ground, body)];
        else if (mode === "back" && walkOn(body, walk, reducedMotion ? Infinity : TROT * dt)) settle();
        // Sent off, its tail goes the whole way; at home, while you are near.
        const near = mode !== "home" || Math.hypot(body.at.x - x, body.at.z - z) < WAG_RANGE;
        body.frame = near && wag ? "wag" : "sit";
      },
      onVisit(_, elapsed) {
        if (there(body)) settle();
        // From its place it stays a moment first, so the key you just picked up does not seem to send it off; on its way somewhere, it just turns.
        else if (mode === "home") [mode, until] = ["stay", elapsed + LINGER_S];
        else [mode, walk] = ["back", walkHome(ground, body)];
      },
    };
  },
};
