// The frog (#57): on the lily pad nearest the gate, or beside its word's plant.
// Asleep by day, as in the strip, and all day on about one day in 25. Awake,
// a tap makes it croak one of your known words, its throat puffed up. Called
// (#377), it croaks back once, awake or asleep.

import { rareDay } from "../../core/day";
import { FROG, FROG_ASLEEP, FROG_CROAK } from "../visitorArt";
import { frogCroak } from "../visitors";
import { padByGate } from "../spots";
import { bodyAt, type VisitorKind } from "./kind";

/** How long its throat stays puffed up after a croak (s). */
const PUFF_S = 0.7;
/** Its hop from pad to pad (#358): how long it takes (s) and how high it goes (m). */
const HOP_S = 0.45;
const HOP_UP = 0.3;

type Look = "awake" | "croak" | "asleep";

export const frog: VisitorKind<Look> = {
  id: "frog",
  art: { awake: FROG, croak: FROG_CROAK, asleep: FROG_ASLEEP },
  hit: [0.17, 0.25, 0.2],
  top: 0.42,
  arrive({ spots, layout, home, now, reducedMotion }) {
    const pad = padByGate(spots, layout);
    const { pads } = spots;
    /** The pad it sits on (null: at its word's plant), and its hop from the last one (t: 0 to 1, from x, z). */
    let on = home ? null : pads.indexOf(pad);
    const hop = { t: 1, x: 0, z: 0 };
    // Beside its word's plant, in its bed; or on the lily pad nearest the gate.
    const body = home ? bodyAt<Look>(home.x - 0.14, home.soil, home.z + 0.1, "asleep") : bodyAt<Look>(pad[0], 0.075, pad[1], "asleep");
    const sleepy = rareDay(25, "frog-asleep", now);
    let awake = false;
    /** Its throat is puffed up until then (elapsed s); its croaks so far in this walk. */
    let puffed = -1;
    let croaks = 0;
    const rest = () => {
      body.frame = awake ? "awake" : "asleep";
      body.mute = !awake;
    };
    rest();
    return {
      size: 0.42,
      body,
      onConditions({ dark }) {
        awake = dark && !sleepy;
        puffed = -1;
        rest();
      },
      step({ dt, elapsed }) {
        if (hop.t < 1) {
          // Mid-hop: from the pad it left to where it sits now, in a small arc.
          hop.t = Math.min(1, hop.t + dt / HOP_S);
          const { at } = body;
          body.x = hop.x + (at.x - hop.x) * hop.t;
          body.y = at.y + Math.sin(Math.PI * hop.t) * HOP_UP;
          body.z = hop.z + (at.z - hop.z) * hop.t;
        }
        if (puffed >= 0 && elapsed > puffed) {
          puffed = -1;
          rest();
        }
      },
      onSplash() {
        // A pebble in the pond: on a pad, it hops to the next one and stays there. With reduced motion it is there at once.
        if (on === null) return false;
        on = (on + 1) % pads.length;
        const [x, z] = pads[on];
        Object.assign(hop, { t: reducedMotion ? 1 : 0, x: body.at.x, z: body.at.z });
        body.at.x = x;
        body.at.z = z;
        if (reducedMotion) [body.x, body.z] = [x, z];
        return true;
      },
      onTap({ elapsed, known, lang }) {
        // Asleep, it is tapped like any visitor: its tag and its word.
        if (!awake) return null;
        puffed = elapsed + PUFF_S;
        body.frame = "croak";
        return frogCroak(known, lang, croaks++, now);
      },
      onCall({ elapsed, lang }) {
        // Croaks back once, just its sound, puffed up: asleep too, then it sleeps on.
        puffed = elapsed + PUFF_S;
        body.frame = "croak";
        return { line: awake ? "The frog croaks back." : "The frog croaks once in its sleep.", say: frogCroak([], lang, 0, now) };
      },
    };
  },
};
