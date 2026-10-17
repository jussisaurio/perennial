// The dog (#209): sitting beside its word's plant, looking at it, and wagging
// its tail while you are near. A word set aside has no plant: then it stays
// away. With reduced motion it just sits.

import { DOG, DOG_WAG } from "../visitorArt";
import { bodyAt, type VisitorKind } from "./kind";

/** How long each frame of the wag shows (s), and how near you come before it wags (m). */
const WAG_S = 0.3;
const WAG_RANGE = 2.4;

type Look = "sit" | "wag";

export const dog: VisitorKind<Look> = {
  id: "dog",
  art: { sit: DOG, wag: DOG_WAG },
  hit: [0.25, 0.3, 0.27],
  arrive({ home, reducedMotion }) {
    if (!home) return null;
    const body = bodyAt<Look>(home.x - 0.24, home.soil, home.z + 0.12, "sit");
    return {
      size: 0.7,
      body,
      step({ elapsed, x, z }) {
        const near = Math.hypot(body.at.x - x, body.at.z - z) < WAG_RANGE;
        body.frame = !reducedMotion && near && Math.floor(elapsed / WAG_S) % 2 === 1 ? "wag" : "sit";
      },
    };
  },
};
