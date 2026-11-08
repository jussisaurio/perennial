// The lookout (#683, #722, #858, beats of #639): the top of a small hill past
// the stile, up the old path, with the old gardener's stool, a lantern on a
// post, and the gardener's diary on a flat stone. From there, across the
// valley, a tiny house with a lantern on a post beside it. The hill hides it
// from the garden and from the stile's top board. Once the learner has the
// note that tells of the hill (n08), the brambles are cut and you walk over
// the stile and up the old path (#770); before, they shut it. Blow the
// lantern out and light it again, twice, and once the learner has the note
// that tells of it (n12), the far light answers. Pure: where things go, and
// when the far light is on. The scene draws it (sceneStile.ts, sceneSky.ts,
// sceneLanterns.ts, sceneLookout.ts).

import type { PerLang } from "./nouns";
import type { Note } from "./notes/note";
import { BRAMBLES_IN, STEP, type StileSpot } from "./stile";
import { WALKER, type BackWay } from "./world";

/** The note that tells of the hill: "Behind the stile, a hill. From the top, at midnight: the far light". From it on, the stile goes over. */
export const HILL_NOTE = "n08";
/** The note that tells of the answer: "I made two signals with the light. The far light answered with two." */
export const ANSWER_NOTE = "n12";

/** The hill past the stile: its top this far out from the back fence along the old path, how high it is, and how far from its top its foot reaches (m). High enough that from the stile's top board it hides the far house. */
export const HILL = { out: 11, h: 2.6, r: 9 };
/** The old path's turn off straight out from the fence (rad, toward −x). */
export const PATH_TURN = 0.12;

/** The open grass on the hill's top, ringed by brambles (m): about eleven metres across. */
export const HILLTOP_R = 5.5;
/** Half the width of the way cut through the brambles, up the old path (m): a little wider than the path. */
export const CUT = 1.05;
/** The lookout's things a walker goes round: the lantern's post, the stool and the diary's stone (m, sceneLanterns.ts, sceneLookout.ts). */
const POST_R = 0.08;
export const STOOL_R = 0.22;
export const STONE_R = 0.28;

/**
 * The lantern's post from the stool (m, and rad left of straight at the far
 * house): sat on the stool, it stands in view in front of you, beside the far
 * house even on a phone's narrow view, and in reach (sceneLanterns.ts LANTERN_REACH).
 */
const POST = { d: 1.35, turn: 0.12 };

/** Near enough to the stool (m, from its middle) to sit on it, and to the diary's stone to read it. */
export const STOOL_REACH = 1;
export const DIARY_REACH = 1;

/** Where the lookout's things stand on the hill, each as [x, z]; `face` is the yaw that looks from the stool to the far house. */
export interface Lookout {
  top: [number, number];
  post: [number, number];
  stool: [number, number];
  stone: [number, number];
  face: number;
}

export function lookoutAt(s: StileSpot): Lookout {
  const [x, z] = [s.x - Math.sin(PATH_TURN) * HILL.out, s.z - Math.cos(PATH_TURN) * HILL.out];
  const stool: [number, number] = [x + 0.55, z - 0.35];
  // Sat on the stool, you face the far house: the post ahead and a little to your left, so your lantern stands in view beside the far one; the stone a metre and a half to your right.
  const [hx, hz] = [Math.sin(FAR_HOUSE.turn) * FAR_HOUSE.r, Math.cos(FAR_HOUSE.turn) * FAR_HOUSE.r];
  const d = Math.hypot(hx - stool[0], hz - stool[1]);
  const [fx, fz] = [(hx - stool[0]) / d, (hz - stool[1]) / d];
  // Forward is −z at yaw 0; your left is (fz, −fx).
  const [ahead, left] = [Math.cos(POST.turn) * POST.d, Math.sin(POST.turn) * POST.d];
  return {
    top: [x, z],
    stool,
    post: [stool[0] + fx * ahead + fz * left, stool[1] + fz * ahead - fx * left],
    stone: [stool[0] - fz * 1.5, stool[1] + fx * 1.5],
    face: Math.atan2(-fx, -fz),
  };
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
      { x: at.stone[0], z: at.stone[1], r: STONE_R },
    ],
  };
}

/** The hill's grass is drawn as flat triangles: a grid of this many squares a side over the square round its foot, two triangles each. */
const HILL_GRID = 36;
const HILL_CELL = (HILL.r * 2) / HILL_GRID;

/** The smooth mound the grid's corners lie on (m): 0 past its foot. */
function mound(at: Lookout, x: number, z: number): number {
  const k = Math.max(0, 1 - Math.hypot(x - at.top[0], z - at.top[1]) / HILL.r);
  return HILL.h * k * k * (3 - 2 * k);
}

/**
 * The hill's ground as it is drawn (sceneStile.ts): each grid corner as
 * [x, y, z], and the triangles, three corners each, facing up. Each square is
 * split from its (+x, −z) corner to its (−x, +z) corner, as hillY reads it.
 */
export function hillMesh(at: Lookout): { position: Float32Array; index: number[] } {
  const n = HILL_GRID + 1;
  const [x0, z0] = [at.top[0] - HILL.r, at.top[1] - HILL.r];
  const position = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const [x, z] = [x0 + i * HILL_CELL, z0 + j * HILL_CELL];
      position.set([x, mound(at, x, z), z], (j * n + i) * 3);
    }
  const index: number[] = [];
  for (let j = 0; j < HILL_GRID; j++)
    for (let i = 0; i < HILL_GRID; i++) {
      const a = j * n + i;
      // a, then +x (b), +z (c), and both (d).
      const [b, c, d] = [a + 1, a + n, a + n + 1];
      index.push(a, c, b, c, d, b);
    }
  return { position, index };
}

/**
 * How high the ground is at (x, z) past the back fence (m): the height of the
 * hill's drawn triangle there (hillMesh), 0 off it. The one height for the
 * hill: what stands or walks on it stands on the grass you see (#861).
 */
export function hillY(at: Lookout, x: number, z: number): number {
  const [x0, z0] = [at.top[0] - HILL.r, at.top[1] - HILL.r];
  const [gx, gz] = [(x - x0) / HILL_CELL, (z - z0) / HILL_CELL];
  if (gx < 0 || gz < 0 || gx >= HILL_GRID || gz >= HILL_GRID) return 0;
  const [i, j] = [Math.floor(gx), Math.floor(gz)];
  const [u, v] = [gx - i, gz - j];
  const y = (di: number, dj: number) => mound(at, x0 + (i + di) * HILL_CELL, z0 + (j + dj) * HILL_CELL);
  if (u + v <= 1) return y(0, 0) + u * (y(1, 0) - y(0, 0)) + v * (y(0, 1) - y(0, 0));
  return y(1, 1) + (1 - u) * (y(0, 1) - y(1, 1)) + (1 - v) * (y(1, 0) - y(1, 1));
}

/**
 * The far house, on the back hills across the valley (sceneSky.ts HILLS):
 * this many radians round from +z (toward +x), this far out (just inside the
 * hills' ring), its bottom this high, and its size (m), the lantern's post
 * beside it too. A little left of straight ahead from the hill's top, below
 * the ridge behind it.
 */
export const FAR_HOUSE = { turn: Math.PI + 0.14, r: 149, y: 2.6, w: 7.5, h: 4.2 };
/** The far lantern's glass in the house's texture, from its bottom left, as a share of its width and height (textures.ts farHouse). */
export const FAR_LANTERN = { u: 14.5 / 16, v: 4.5 / 9 };

/** Does the learner have note `id` (HILL_NOTE, ANSWER_NOTE)? `notes` is the course's notes, `unlocked` the ids the learner has. A course without it fails loudly. */
export function hasNote(notes: readonly Note[], unlocked: readonly string[], id: string): boolean {
  if (!notes.some((n) => n.id === id)) throw new Error(`no note "${id}" in this course`);
  return unlocked.includes(id);
}

/** After a second signal (s): the far light goes out, on, out, and on for good, slowly: two blinks. */
const BLINK = [3, 4, 5, 6] as const;

/** The quiet line as the far light answers, in the course language, and what it says, for a screen reader. */
export const ANSWER_LINE: PerLang<string> = { es: "El lucero contesta.", de: "Das Fünkchen antwortet." };
export const ANSWER_SPOKEN = "The far light answers: it goes out and comes back, twice.";

/** The signals with the lookout's lantern in one visit, and the far light's answers. Times are the scene's own seconds (Frame.elapsed). */
export class LookoutLight {
  /** The far light answers this visit (from note n12 on). */
  readonly answers: boolean;
  private signals = 0;
  private answeredAt = -Infinity;
  /** The line for the last answer has been shown. */
  private told = true;

  constructor(answers: boolean) {
    this.answers = answers;
  }

  /** The lantern was lit again at `now`, after it was blown out: one signal. Once it answers, every second signal gets an answer. */
  signal(now: number) {
    this.signals++;
    if (!this.answers || this.signals % 2) return;
    this.answeredAt = now;
    this.told = false;
  }

  /** Is the far light on at `now` (at dusk and night)? Always, but for the two blinks of an answer. */
  on(now: number): boolean {
    const t = now - this.answeredAt;
    return !((t >= BLINK[0] && t < BLINK[1]) || (t >= BLINK[2] && t < BLINK[3]));
  }

  /** Has an answer just begun at `now`? True once for each answer, so its line shows once. */
  answering(now: number): boolean {
    if (this.told || now < this.answeredAt + BLINK[0]) return false;
    this.told = true;
    return true;
  }
}
