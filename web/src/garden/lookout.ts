// The lookout (#683, a beat of #639): a gap in the orchard's far hedge, with
// the old gardener's stool and a lantern on a post. Through it, across the
// valley, a tiny house; at night one warm light in its window. Raise the
// lantern, and once the learner has the note that tells of it (n12), the far
// light blinks twice back, once a visit. Pure: where things go, and when the
// light is on. The scene draws it (sceneSky.ts, sceneLanterns.ts).

import type { OrchardArea } from "./orchard";
import type { Note } from "./notes/note";

/** The note that tells of the answer: "I flicked the light twice. The far light answered twice." The far light answers once it is on the shed's nails. */
export const ANSWER_NOTE = "n12";

/** The gap in the far hedge: its middle this far right of the orchard's middle (between two tree columns, orchard.ts), and its width (m). */
const GAP = { off: 5, w: 1.6 };

/** Near enough to the lantern's post (m) to raise it. */
export const RAISE_REACH = 1.3;

/** Where the lookout's things stand: the gap in the hedge, the lantern's post and the stool in it, each as [x, z]. */
export interface Lookout {
  /** The gap's middle along the hedge, its two sides, and the hedge's inner face. */
  x: number;
  x0: number;
  x1: number;
  z: number;
  post: [number, number];
  stool: [number, number];
}

export function lookoutAt(o: OrchardArea): Lookout {
  const x = o.x + GAP.off;
  const z = o.z + o.d / 2;
  return { x, x0: x - GAP.w / 2, x1: x + GAP.w / 2, z, post: [x - 0.55, z + 0.25], stool: [x + 0.45, z + 0.4] };
}

/**
 * The far house, on the front hill across the valley (sceneSky.ts HILLS): this
 * many radians round from +z (toward +x), this far out (just inside the hills'
 * ring), its bottom this high, and its size (m). A little right of straight
 * ahead from the gap, below the front ridge; the hedge hides it from
 * everywhere else.
 */
export const FAR_HOUSE = { turn: 0.14, r: 149, y: 2.6, w: 5.6, h: 4.2 };
/** The window's middle in the house's texture, from its bottom left, as a share of its width and height (textures.ts farHouse). */
export const FAR_WINDOW = { u: 0.625, v: 0.22 };

/** Is the far light's answer earned: is note n12 on the shed's nails? `notes` is the course's notes, `unlocked` the ids the learner has. */
export function lightAnswers(notes: readonly Note[], unlocked: readonly string[]): boolean {
  if (!notes.some((n) => n.id === ANSWER_NOTE)) throw new Error(`no note "${ANSWER_NOTE}" to answer the lantern`);
  return unlocked.includes(ANSWER_NOTE);
}

/** How long the lantern stays up (s): it rises, holds, and comes down. */
const LIFT = { up: 0.4, hold: 1.4, down: 0.5 };
/** After the raise (s): the far light goes out, on, out, and on for good: two blinks. */
const BLINK = [2, 2.3, 2.65, 2.95] as const;

/** What a raise of the lantern brought: no far light to see (dusk), the far light shining on, or its answer. */
export type Raised = "dusk" | "steady" | "blink";

/** The lantern's raises in one visit, and the far light's answer. Times are the scene's own seconds (Frame.elapsed). */
export class LookoutLight {
  /** The far light answers this visit (lightAnswers). */
  answers: boolean;
  private raisedAt = -Infinity;
  private answeredAt = -Infinity;

  constructor(answers: boolean) {
    this.answers = answers;
  }

  /** Raise the lantern at `now`. At night, the first raise once it answers gets the blinks; every later one, none. */
  raise(now: number, night: boolean): Raised {
    this.raisedAt = now;
    if (!night) return "dusk";
    if (!this.answers || this.answeredAt > -Infinity) return "steady";
    this.answeredAt = now;
    return "blink";
  }

  /** How high the lantern is lifted at `now`, 0 to 1. */
  lift(now: number): number {
    const t = now - this.raisedAt;
    if (t < 0 || t > LIFT.up + LIFT.hold + LIFT.down) return 0;
    const k = t < LIFT.up ? t / LIFT.up : t < LIFT.up + LIFT.hold ? 1 : 1 - (t - LIFT.up - LIFT.hold) / LIFT.down;
    // Eased: it slows at the top and at the bottom.
    return k * k * (3 - 2 * k);
  }

  /** Is the far light on at `now` (at night)? Always, but for its two blinks after the answer. */
  on(now: number): boolean {
    const t = now - this.answeredAt;
    return !((t >= BLINK[0] && t < BLINK[1]) || (t >= BLINK[2] && t < BLINK[3]));
  }
}
