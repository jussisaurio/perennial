// The dog (#209): sitting beside its word's plant, looking at it, and wagging
// its tail while you are near. A word set aside has no plant: then it stays
// away. With reduced motion it just sits. Called (#377), it runs to you, tail
// going, sits with you a while and trots home. Throw something by it and it
// fetches (#335 S2): it runs to it, brings something back to you, wags a
// moment, and trots home. With reduced motion it does not run: it is just
// there, then just by you.

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
/** A fetch: its legs' frames as it runs (s); how near you it stops, where you can see it, to drop what it brings (m); how long it waits by you, wagging, before it goes home (s). */
const FETCH = { legs: 0.1, drop: 1.4, wait: 1.5 };

type Look = "sit" | "wag";

export const dog: VisitorKind<Look> = {
  id: "dog",
  art: { sit: DOG, wag: DOG_WAG },
  hit: [0.25, 0.3, 0.27],
  arrive({ home, reducedMotion }) {
    if (!home) return null;
    const body = bodyAt<Look>(home.x - 0.24, home.soil, home.z + 0.12, "sit");
    /**
     * Called: running to where you were ("come"), sitting there until `until`
     * (elapsed s). Fetching: running out to `to` ("fetch"), bringing what it
     * took to you ("bring"), waiting by you until `until`. Then going home ("back").
     */
    let mode: "home" | "come" | "stay" | "fetch" | "bring" | "wait" | "back" = "home";
    let to = { x: 0, z: 0 };
    let until = 0;
    const settle = () => {
      mode = "home";
      [body.x, body.y, body.z] = [body.at.x, body.at.y, body.at.z];
    };
    /** Out on a fetch, with something to bring: the walk waits for it (sceneCarry.ts), so nothing else may stop it. */
    const fetching = () => mode === "fetch" || mode === "bring";
    const run = (dt: number) => (reducedMotion ? Infinity : RUN * dt);
    return {
      size: 0.7,
      body,
      step({ dt, elapsed, x, z }) {
        const wag = !reducedMotion && Math.floor(elapsed / WAG_S) % 2 === 1;
        // Running for something, its legs go.
        const legs = !reducedMotion && Math.floor(elapsed / FETCH.legs) % 2 === 1;
        if (mode === "fetch") {
          body.frame = legs ? "wag" : "sit";
          if (!moveToward(body, to.x, to.z, run(dt))) return;
          mode = "bring";
          return "took";
        }
        if (mode === "bring") {
          body.frame = legs ? "wag" : "sit";
          // You may walk on: it follows you, and stops short of you.
          const left = Math.hypot(x - body.x, z - body.z) - FETCH.drop;
          const d = Math.min(left, run(dt));
          moveToward(body, x, z, Math.max(0, d));
          if (d < left) return;
          [mode, until] = ["wait", elapsed + FETCH.wait];
          return "dropped";
        }
        if (mode === "come" && moveToward(body, to.x, to.z, run(dt))) [mode, until] = ["stay", elapsed + STAY_S];
        else if ((mode === "stay" || mode === "wait") && elapsed > until) mode = "back";
        else if (mode === "back" && moveToward(body, body.at.x, body.at.z, reducedMotion ? Infinity : TROT * dt)) settle();
        // Called or fetching, its tail goes the whole time it is with you; at home, while you are near.
        const near = mode !== "home" || Math.hypot(body.at.x - x, body.at.z - z) < WAG_RANGE;
        body.frame = near && wag ? "wag" : "sit";
      },
      onVisit() {
        // Mid-fetch it carries on from where it was moved to.
        if (!fetching()) settle();
      },
      onCall({ x, z }) {
        // Out on a fetch, it does not hear you.
        if (fetching()) return null;
        to = besideYou(body, x, z, AT_FEET);
        mode = "come";
        return { line: "The dog runs over, tail going." };
      },
      fetch(x, z) {
        if (fetching()) return false;
        [mode, to] = ["fetch", { x, z }];
        return true;
      },
    };
  },
};
