// A kind of visitor in the walk-in garden, as data (#324): its art, where it
// sits today, and how it acts. One pure file per kind (no three, no DOM, no
// clock), listed once in kinds/index.ts. The runtime (sceneVisitors.ts) owns
// the sprites, picking, tags and speech bubbles, and draws each visitor's Body
// every frame. Kinds never refer to each other: they meet only through Spots
// and Conditions.

import type { Conditions } from "../conditions";
import { wayNear, type Ground } from "../ground";
import type { Frame } from "../scenePart";
import type { Spots } from "../spots";
import type { Cutout } from "../visitorArt";
import type { FrogWords, VisitorId } from "../visitors";
import type { Layout } from "../world";

/** A plant in bloom, for a visitor that rests on flowers (the butterfly). */
export interface Bloom {
  x: number;
  z: number;
  /** The height of the bed's soil (m). */
  soil: number;
  /** The height of the top of the plant, as its sprite draws it (m). */
  top: number;
  /** It droops for water: a visitor on top sits lower, by its stem. */
  thirsty: boolean;
}

/** What a visitor is told when it arrives, as the garden is built. @internal Exported for tests. */
export interface Arrival {
  spots: Spots;
  layout: Layout;
  /** The ground as it is now, for a visitor that walks (#761). */
  ground: Ground;
  /** Today's bloom (#641): a plant in bloom picked by the day, or null when nothing is in bloom. */
  bloom: Bloom | null;
  /** The moment the walk opened: daily picks use its calendar day. */
  now: Date;
  /** The garden's age: calendar days since the first review (0 for a new learner). Never words or study days. */
  age: number;
  reducedMotion: boolean;
  /** The course language, for what it says unasked (Body.says). */
  lang: string;
}

/** Where a visitor hid today (#379), said plainly: "under the bench", or "behind" and a word in the course language ("manzana"). */
export interface Hideout {
  text: string;
  word: string | null;
}

/** One visitor as the runtime draws it. Its hooks change these; the runtime uploads only what changed. */
export interface Body<F extends string> {
  /** Where it sits now: its spot today, or where the scene asked it to wait (visit). It may travel (the snail, the fish). */
  at: { x: number; y: number; z: number };
  /** Where it is drawn: `at`, unless it is moving away from it (hopping, stepping back, flying). */
  x: number;
  y: number;
  z: number;
  frame: F;
  visible: boolean;
  /** A lying visitor's heading (rad): which way its head points. */
  turn: number;
  /** How much its tag shows as you come near (0 to 1): the gnome hides it while it looks away. */
  tag: number;
  /** Its own small light is lit (a kind with `glow`). */
  glow: boolean;
  /** It cannot talk now (the frog asleep): what it said goes. */
  mute: boolean;
  /** It hides (#379): its tag never shows, and the action button near it finds it. */
  hiding: boolean;
  /** Where it hid today, said after its tag once it is found; null on a day it did not hide. */
  hid: Hideout | null;
  /** What it says now without being tapped, in a bubble, in the course language (the mole's "¿Hola?"); null: nothing. */
  says: string | null;
  /** What a screen reader hears about it now, in plain English ("A goat stands on top of the hedge."); null: nothing. */
  status: string | null;
  /** What it looks at while it sits at its spot (#802: the key it waits by), or null: its art faces the camera's right. */
  looks: { x: number; z: number } | null;
}

/** A tap that a visitor may answer. */
interface Tap {
  elapsed: number;
  /** What the frog may say to this learner, in the course language. */
  frog: FrogWords;
  lang: string;
}

/** Each animal that makes a sound: a real recording of its own (ui/animalSounds.ts), never the course voice (#739). */
export type AnimalSound = "frog";

/** How long a visitor's short bubble shows (s). */
export const SAY_S = 3.2;

/** A visitor's answer to a tap: its bubble and how long it shows (s), and its recorded sound (the bubble's words are not said aloud). */
export interface Reply {
  say: string;
  seconds: number;
  sound: AnimalSound;
}

/** One visitor in today's walk: its body and its hooks. */
export interface Visitor<F extends string> {
  /** Its cell's size (m). */
  size: number;
  body: Body<F>;
  /**
   * One frame: react to you (f.x, f.z) and move. `seen`: it is on screen.
   * Allocates nothing. "startled": it flew off, so its tapped tag goes.
   */
  step?(f: Frame, seen: boolean): void | "startled";
  onConditions?(c: Conditions): void;
  /** Its answer to a tap, in a bubble instead of its tag and aloud; null shows its tag as usual. */
  onTap?(t: Tap): Reply | null;
  /**
   * The scene gave it a new spot (body.at): go there from where it is drawn, in
   * its own way (#802: never at once, unless it is drawn there already).
   * `settled`: it sits with you on the bench (#362), so it does not mind you near.
   */
  onVisit?(settled: boolean, elapsed: number): void;
  /** It was found while it hid (#379): a tap on it, or the action button near it. */
  onFind?(elapsed: number): void;
  /** Something lands in the pond (#358). True when it answers (and so the walk says so). */
  onSplash?(): boolean;
  /** A lantern was blown out or lit again (#361), `on` by spot (Spots.lanterns). What it says about it, or null. */
  onLanterns?(on: readonly boolean[]): string | null;
}

export interface VisitorKind<F extends string = string> {
  id: VisitorId;
  /** Its frames in the shared visitor atlas (cells of 32×32 units, standing on the bottom). */
  art: Record<F, Cutout>;
  /** The drawn part: its middle height and half width and height, as fractions of the cell. Default [0.2, 0.4, 0.3]. */
  hit?: [number, number, number];
  /** Where its tag sits, as a fraction of the cell's height. Default 0.55. */
  top?: number;
  /** How near you come before its tag shows, for an "approach" tag (m). Default 1.5. */
  tagRange?: number;
  /** It lies flat, seen from above (the fish), showing the part its art fills at the bottom of the cell. */
  lying?: boolean;
  /** A small light it carries (the gnome's lantern): where in its cell (fractions, x toward the camera's right) and how big (m). */
  glow?: { dx: number; dy: number; size: number };
  /** Always in a lantern's light, whatever the time of day (the moth). */
  lit?: boolean;
  /** Where it is today and how it acts; null: it stays away today. */
  arrive(a: Arrival): Visitor<F> | null;
}

/** A body standing still at a spot, showing `frame`. */
export function bodyAt<F extends string>(x: number, y: number, z: number, frame: F): Body<F> {
  return { at: { x, y, z }, x, y, z, frame, visible: true, turn: 0, tag: 1, glow: false, mute: false, hiding: false, hid: null, says: null, status: null, looks: null };
}

/** Within this far of where it set off or of its spot (m), a walking visitor comes down to the ground or goes up (a spot may be up on a bed or the bench). */
const STEP_DOWN = 0.5;

/** A visitor's walk on the ground (#761): its way (ground.ts) from where it was drawn, the corner it heads for, and the height it set off from. */
export interface Walk {
  way: [number, number][];
  leg: number;
  y: number;
}

/** A walk from where a visitor is drawn, round whatever is in the way, to `stop` metres from (x, z), or as near as it may come. */
export function walkTo(ground: Ground, body: Body<string>, x: number, z: number, stop: number): Walk {
  return { way: wayNear(ground, body.x, body.z, x, z, stop), leg: 1, y: body.y };
}

/** Is a body drawn at its spot? */
export function there(body: Body<string>): boolean {
  return body.x === body.at.x && body.y === body.at.y && body.z === body.at.z;
}

/** A walk back to its own spot; the last short step is onto it, as its spot may lie a hair inside a walker's clearance (the heron on the pond's stones). */
export function walkHome(ground: Ground, body: Body<string>): Walk {
  const way = wayNear(ground, body.x, body.z, body.at.x, body.at.z, 0);
  way.push([body.at.x, body.at.z]);
  return { way, leg: 1, y: body.y };
}

/**
 * Moves a body's drawn place along its walk by `d` metres (Infinity: there at
 * once), coming down from where it set off (a seat, a step) and going up onto
 * its spot as it comes near. True once it is at the walk's end. No allocation:
 * it runs every frame.
 */
export function walkOn(body: Body<string>, w: Walk, d: number): boolean {
  while (w.leg < w.way.length) {
    const [x, z] = w.way[w.leg];
    const gap = Math.hypot(x - body.x, z - body.z);
    if (gap > d) {
      body.x += ((x - body.x) * d) / gap;
      body.z += ((z - body.z) * d) / gap;
      break;
    }
    body.x = x;
    body.z = z;
    d -= gap;
    w.leg++;
  }
  const [sx, sz] = w.way[0];
  const down = w.y * Math.max(0, 1 - Math.hypot(body.x - sx, body.z - sz) / STEP_DOWN);
  body.y = Math.max(down, body.at.y * Math.max(0, 1 - Math.hypot(body.x - body.at.x, body.z - body.at.z) / STEP_DOWN));
  return w.leg === w.way.length;
}
