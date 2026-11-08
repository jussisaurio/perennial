// The frog (#57): on the lily pad nearest the gate.
// Asleep by day, as in the strip, and all day on about one day in 25. Awake,
// a tap makes it croak one of your known words, its throat puffed up: a real
// recorded croak, and the word in its bubble (#739). Tapped on, it says its
// lines instead (#902), then has no more words.

import { rareDay } from "../../core/day";
import { FROG, FROG_ASLEEP, FROG_CROAK } from "../visitorArt";
import { frogCroak } from "../visitors";
import { padByGate } from "../spots";
import { bodyAt, SAY_S, type VisitorKind } from "./kind";

/** How long its throat stays puffed up after a croak (s). */
const PUFF_S = 0.7;
/** Its hop from pad to pad (#358): how long it takes (s) and how high it goes (m). */
const HOP_S = 0.45;
const HOP_UP = 0.3;
/** Taps that croak a word before it starts on its lines (#902). */
const CROAKS_FIRST = 2;
/** A tap this soon after a line shows the line again (s): a double tap skips nothing. */
const REREAD_S = 1.5;
/** How long a line stays (s): time to read it slowly in a language you are learning. */
const lineSeconds = (text: string) => 6 + 0.5 * text.split(" ").length;

type Look = "awake" | "croak" | "asleep";

export const frog: VisitorKind<Look> = {
  id: "frog",
  art: { awake: FROG, croak: FROG_CROAK, asleep: FROG_ASLEEP },
  hit: [0.17, 0.25, 0.2],
  top: 0.42,
  arrive({ spots, layout, now, reducedMotion }) {
    const pad = padByGate(spots, layout);
    const { pads } = spots;
    /** The pad it sits on, and its hop from the last one (t: 0 to 1, from x, z). */
    let on = pads.indexOf(pad);
    const hop = { t: 1, x: 0, z: 0 };
    const body = bodyAt<Look>(pad[0], 0.075, pad[1], "asleep");
    const sleepy = rareDay(25, "frog-asleep", now);
    let awake = false;
    /** Its throat is puffed up until then (elapsed s); its taps so far in this walk; when it last said a line (elapsed s). */
    let puffed = -1;
    let taps = 0;
    let lineAt = -Infinity;
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
        on = (on + 1) % pads.length;
        const [x, z] = pads[on];
        Object.assign(hop, { t: reducedMotion ? 1 : 0, x: body.at.x, z: body.at.z });
        body.at.x = x;
        body.at.z = z;
        if (reducedMotion) [body.x, body.z] = [x, z];
        return true;
      },
      onTap({ elapsed, frog: { croaks, lines }, lang }) {
        // Asleep, it is tapped like any visitor: its tag and its word.
        if (!awake) return null;
        puffed = elapsed + PUFF_S;
        body.frame = "croak";
        if (elapsed - lineAt < REREAD_S) taps--;
        const n = taps++;
        const line = n - CROAKS_FIRST;
        if (line >= 0 && line < lines.length) {
          lineAt = elapsed;
          return { say: lines[line], seconds: lineSeconds(lines[line]), sound: "frog" };
        }
        lineAt = -Infinity;
        // Its last line said it has no more words: from then on it croaks with none.
        return { say: frogCroak(line < 0 || !lines.length ? croaks : [], lang, n, now), seconds: SAY_S, sound: "frog" };
      },
    };
  },
};
