// The mole behind your back (#376, #335 G2). Stand still a few seconds, then
// walk on: once you are a few steps away and not looking, a molehill rises
// where you stood, the mole looks out, says "¿Hola?" to the empty air and
// goes back down. Turn round fast enough to see it and it panics and digs
// down at comic speed. A few times a visit at most, and on some visits never:
// how many is seeded by the moment the walk opened.

import { hash32 } from "../../lib/seed";
import { inLang, type PerLang } from "../nouns";
import { MOLE_DIG, MOLE_DIG_2, MOLE_HILL, MOLE_PANIC, MOLE_UP } from "../visitorArt";
import { bodyAt, type VisitorKind } from "./kind";

/** What it says to nobody, per course language. */
const HELLO: PerLang<string> = { es: "¿Hola?", de: "Hallo?" };

/** Stand within `move` m of one place this long (s), and the mole may come up there once you have gone. */
export const STILL = { s: 2.5, move: 0.2 };
/** It comes up once you are `near` m from where you stood, at least `after` s after you left it; it forgets the place when you go `far` or after `wait` s. */
export const BEHIND = { near: 2, after: 1.5, far: 10, wait: 12 };
/** At least this long (s) from one time it goes down to the next place it may come up. */
export const GAP = 60;
/** Coming up (s from when the hill starts to rise): the hill alone, then it looks out, then the hill alone again. */
export const POP = { hill: 0.5, up: 2.5, end: 2.9 };
/** Caught (s from when you saw it): it panics, digs (a frame every `flick` s), then the hill alone; a screen reader's line stays `heard` s. */
export const CAUGHT = { panic: 0.35, dig: 0.95, flick: 0.06, end: 1.2, heard: 4 };
/** How many times it comes up in one visit: never on some visits, a few times on others. */
const POPS = [0, 1, 1, 2, 3] as const;

/** How many times the mole comes up in the walk that opened at `now`. */
export function molePops(now: Date): number {
  return POPS[hash32(`visitor-mole:${now.getTime()}`) % POPS.length];
}

export const MOLE_CAUGHT = "A mole looks out of the ground where you stood. It sees you and digs away, fast.";

type Look = "hill" | "up" | "panic" | "dig" | "dig2";

export const mole: VisitorKind<Look> = {
  id: "mole",
  art: { hill: MOLE_HILL, up: MOLE_UP, panic: MOLE_PANIC, dig: MOLE_DIG, dig2: MOLE_DIG_2 },
  hit: [0.25, 0.25, 0.25],
  top: 0.45,
  arrive({ now, lang, reducedMotion }) {
    const body = bodyAt<Look>(0, 0, 0, "hill");
    body.visible = false;
    // A course with no word for hello: it looks out and says nothing.
    const hello = inLang(HELLO, lang);
    let left = molePops(now);
    /** Where you stand, and since when (elapsed s); NaN before the first frame. */
    let sx = NaN;
    let sz = NaN;
    let since = 0;
    /** When you left the place you stood still at (body.at), -1: no such place now. */
    let gone = -1;
    /** When it started to come up, and when you caught it (elapsed s); -1: not now. */
    let pop = -1;
    let caught = -1;
    /** It may come up again from this time, and a screen reader's line stays until this time (elapsed s). */
    let next = 0;
    let heard = 0;
    return {
      // Bigger than a real mole: at a few steps it must read as one at a glance.
      size: 0.75,
      body,
      step({ elapsed, x, z }, seen) {
        if (body.status && elapsed >= heard) body.status = null;
        // Moved off where you stood (always, on the first frame): if you stood there long enough, that place is behind you now.
        if (!(Math.hypot(x - sx, z - sz) < STILL.move)) {
          if (pop < 0 && left > 0 && elapsed - since >= STILL.s && elapsed >= next) {
            [body.at.x, body.at.z, body.x, body.z] = [sx, sz, sx, sz];
            gone = elapsed;
          }
          [sx, sz, since] = [x, z, elapsed];
        }
        if (pop >= 0) {
          const t = elapsed - pop;
          if (caught < 0 && seen && t < POP.up) {
            caught = elapsed;
            body.says = null;
            body.status = MOLE_CAUGHT;
            heard = elapsed + CAUGHT.heard;
          }
          const c = elapsed - caught;
          if (caught >= 0 ? c >= CAUGHT.end : t >= POP.end) {
            body.visible = false;
            body.says = null;
            pop = caught = -1;
            next = elapsed + GAP;
            left--;
            return;
          }
          if (caught >= 0) body.frame = c < CAUGHT.panic ? "panic" : c >= CAUGHT.dig ? "hill" : reducedMotion || Math.floor(c / CAUGHT.flick) % 2 === 0 ? "dig" : "dig2";
          else {
            body.frame = t >= POP.hill && t < POP.up ? "up" : "hill";
            body.says = body.frame === "up" ? hello : null;
          }
          return;
        }
        if (gone < 0) return;
        const d = Math.hypot(x - body.at.x, z - body.at.z);
        if (d > BEHIND.far || elapsed - gone > BEHIND.wait) gone = -1;
        else if (d >= BEHIND.near && elapsed - gone >= BEHIND.after && !seen) {
          gone = -1;
          pop = elapsed;
          body.frame = "hill";
          body.visible = true;
        }
      },
      // A call (#377), asked only while it is up and in sight: it digs down at once, as when caught.
      onCall({ elapsed }) {
        if (pop < 0) return null;
        if (caught < 0) {
          caught = elapsed;
          body.says = null;
        }
        return { line: "The mole digs back down, fast." };
      },
    };
  },
};
