// The dog (#209): sitting beside its word's plant, looking at it, and wagging
// its tail while you are near. A word set aside has no plant: then it stays
// away. With reduced motion it just sits. Called (#377), it runs to you, tail
// going, sits with you a while and trots home.

import { DOG, DOG_WAG } from "../visitorArt";
import { besideYou, bodyAt, moveToward, type VisitorKind } from "./kind";

/** How long each frame of the wag shows (s), and how near you come before it wags (m). */
const WAG_S = 0.3;
const WAG_RANGE = 2.4;
/** Called: it stops this far from you (m), runs and trots home at these speeds (m/s), and stays this long (s). */
const AT_FEET = 0.7;
const RUN = 3.2;
const TROT = 1.4;
const STAY_S = 6;

type Look = "sit" | "wag";

export const dog: VisitorKind<Look> = {
  id: "dog",
  art: { sit: DOG, wag: DOG_WAG },
  hit: [0.25, 0.3, 0.27],
  arrive({ home, reducedMotion }) {
    if (!home) return null;
    const body = bodyAt<Look>(home.x - 0.24, home.soil, home.z + 0.12, "sit");
    /** Called: running to where you were ("come"), sitting there until `until` (elapsed s), then going home. */
    let mode: "home" | "come" | "stay" | "back" = "home";
    let to = { x: 0, z: 0 };
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
        if (mode === "come" && moveToward(body, to.x, to.z, reducedMotion ? Infinity : RUN * dt)) [mode, until] = ["stay", elapsed + STAY_S];
        else if (mode === "stay" && elapsed > until) mode = "back";
        else if (mode === "back" && moveToward(body, body.at.x, body.at.z, reducedMotion ? Infinity : TROT * dt)) settle();
        // Called, its tail goes the whole time it is with you; at home, while you are near.
        const near = mode !== "home" || Math.hypot(body.at.x - x, body.at.z - z) < WAG_RANGE;
        body.frame = near && wag ? "wag" : "sit";
      },
      onVisit() {
        settle();
      },
      onCall({ x, z }) {
        to = besideYou(body, x, z, AT_FEET);
        mode = "come";
        return { line: "The dog runs over, tail going." };
      },
    };
  },
};
