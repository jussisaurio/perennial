// The lookout (#683, #722, beats of #639): the top of a small hill past the
// stile, up the old path, with the old gardener's stool and a lantern on a
// post. From there, across the valley, a tiny house; at night one warm light
// in its window. The hill hides it from the garden and from the stile's top
// board. Once the learner has the note that tells of the hill (n08), the
// brambles are cut and you walk over the stile and up the old path (#770);
// before, they shut it. Raise the lantern, and once the learner has the note that tells
// of it (n12), the far light blinks twice back, once a visit. Pure: where
// things go, and when the light is on. The scene draws it (sceneStile.ts,
// sceneSky.ts, sceneLanterns.ts).

import type { Note } from "./notes/note";
import { BRAMBLES_IN, STEP, type StileSpot } from "./stile";
import { WALKER, type BackWay } from "./world";

/** The note that tells of the hill: "Behind the stile, a hill. From the top, at midnight: the far light". From it on, the stile goes over. */
export const HILL_NOTE = "n08";
/** The note that tells of the answer: "I flicked the light twice. The far light answered twice." */
export const ANSWER_NOTE = "n12";

/** The hill past the stile: its top this far out from the back fence along the old path, how high it is, and how far from its top its foot reaches (m). High enough that from the stile's top board it hides the far house. */
export const HILL = { out: 11, h: 2.6, r: 9 };
/** The old path's turn off straight out from the fence (rad, toward −x). */
export const PATH_TURN = 0.12;

/** The open grass on the hill's top, ringed by brambles (m): about eleven metres across. */
export const HILLTOP_R = 5.5;
/** Half the width of the way cut through the brambles, up the old path (m): a little wider than the path. */
export const CUT = 1.05;
/** The lookout's things a walker goes round: the lantern's post and the stool (m, sceneLanterns.ts buildLookout). */
const POST_R = 0.08;
const STOOL_R = 0.22;

/** Near enough to the lantern's post (m) to raise it. */
export const RAISE_REACH = 1.3;

/** Where the lookout's things stand on the hill, each as [x, z]. */
export interface Lookout {
  top: [number, number];
  post: [number, number];
  stool: [number, number];
}

export function lookoutAt(s: StileSpot): Lookout {
  const [x, z] = [s.x - Math.sin(PATH_TURN) * HILL.out, s.z - Math.cos(PATH_TURN) * HILL.out];
  // Facing on out (−z), the post ahead on the left, in reach but off to the side, so it does not stand in the view; the stool on the right.
  return { top: [x, z], post: [x - 0.85, z - 0.8], stool: [x + 0.55, z - 0.35] };
}

/**
 * The ground past the back fence a walker may stand on (#770, world.ts
 * BackWay). Before the hill's note, the brambles over the stile, a block in
 * front of it. After, over the stile, up the way cut along the old path from
 * a little past the far foot (clear of the rails' ends) to the top, and the
 * hilltop's grass.
 */
export function backWay(s: StileSpot, at: Lookout, open: boolean): BackWay {
  const half = STEP.w / 2;
  if (!open) return { open: false, brambles: [s.x - half - 0.4, s.x + half + 0.4, s.z, s.z + BRAMBLES_IN] };
  const [dx, dz] = [-Math.sin(PATH_TURN), -Math.cos(PATH_TURN)];
  const start = STEP.out + WALKER;
  return {
    open: true,
    stile: { x: s.x, z: s.z, half, out: STEP.out },
    way: { x: s.x + dx * start, z: s.z + dz * start, dx, dz, len: HILL.out - start, half: CUT },
    top: { x: at.top[0], z: at.top[1], r: HILLTOP_R },
    things: [
      { x: at.post[0], z: at.post[1], r: POST_R },
      { x: at.stool[0], z: at.stool[1], r: STOOL_R },
    ],
  };
}

/** How high the hill's ground is at (x, z) (m): a smooth mound, 0 past its foot. */
export function hillY(at: Lookout, x: number, z: number): number {
  const k = Math.max(0, 1 - Math.hypot(x - at.top[0], z - at.top[1]) / HILL.r);
  return HILL.h * k * k * (3 - 2 * k);
}

/**
 * The far house, on the back hills across the valley (sceneSky.ts HILLS):
 * this many radians round from +z (toward +x), this far out (just inside the
 * hills' ring), its bottom this high, and its size (m). A little left of
 * straight ahead from the hill's top, below the ridge behind it.
 */
export const FAR_HOUSE = { turn: Math.PI + 0.14, r: 149, y: 2.6, w: 5.6, h: 4.2 };
/** The window's middle in the house's texture, from its bottom left, as a share of its width and height (textures.ts farHouse). */
export const FAR_WINDOW = { u: 0.625, v: 0.22 };

/** Does the learner have note `id` (HILL_NOTE, ANSWER_NOTE)? `notes` is the course's notes, `unlocked` the ids the learner has. A course without it fails loudly. */
export function hasNote(notes: readonly Note[], unlocked: readonly string[], id: string): boolean {
  if (!notes.some((n) => n.id === id)) throw new Error(`no note "${id}" in this course`);
  return unlocked.includes(id);
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
