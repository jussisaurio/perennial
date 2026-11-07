// The dog (#209): sitting by the shed (#641), and wagging its tail while you
// are near. With reduced motion it just sits. Called (#377), it runs to you, tail
// going, round whatever is in the way (#761), sits with you a while and trots home. With reduced motion it does not
// run: it is just there, then just by you. Sent to wait somewhere else (#334: by a key), or home again, it trots there.

import { DOG, DOG_WAG } from "../visitorArt";
import { bodyAt, there, walkHome, walkOn, walkTo, type VisitorKind, type Walk } from "./kind";

/** How long each frame of the wag shows (s), and how near you come before it wags (m). */
const WAG_S = 0.3;
const WAG_RANGE = 2.4;
/** Called: it stops this far from you (m), runs and trots home at these speeds (m/s), and stays this long (s). */
const AT_FEET = 0.7;
const RUN = 3.2;
const TROT = 1.4;
const STAY_S = 6;
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
    /** Called: running to where you were ("come"), sitting there until `until` (elapsed s), then going home ("back"). */
    let mode: "home" | "come" | "stay" | "back" = "home";
    let walk: Walk = { way: [], leg: 0, y: 0 };
    let until = 0;
    const settle = () => {
      mode = "home";
      [body.x, body.y, body.z] = [body.at.x, body.at.y, body.at.z];
    };
    const run = (dt: number) => (reducedMotion ? Infinity : RUN * dt);
    return {
      size: 0.7,
      body,
      step({ dt, elapsed, x, z }) {
        const wag = !reducedMotion && Math.floor(elapsed / WAG_S) % 2 === 1;
        if (mode === "come" && walkOn(body, walk, run(dt))) [mode, until] = ["stay", elapsed + STAY_S];
        else if (mode === "stay" && elapsed > until) [mode, walk] = ["back", walkHome(ground, body)];
        else if (mode === "back" && walkOn(body, walk, reducedMotion ? Infinity : TROT * dt)) settle();
        // Called, its tail goes the whole time it is with you; at home, while you are near.
        const near = mode !== "home" || Math.hypot(body.at.x - x, body.at.z - z) < WAG_RANGE;
        body.frame = near && wag ? "wag" : "sit";
      },
      onVisit(_, elapsed) {
        if (there(body)) settle();
        // From its place it stays a moment first, so the key you just picked up does not seem to send it off; on its way somewhere, it just turns.
        else if (mode === "home") [mode, until] = ["stay", elapsed + LINGER_S];
        else [mode, walk] = ["back", walkHome(ground, body)];
      },
      onCall({ x, z }) {
        walk = walkTo(ground, body, x, z, AT_FEET);
        mode = "come";
        return { line: "The dog runs over, tail going." };
      },
    };
  },
};
