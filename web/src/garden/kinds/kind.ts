// A kind of visitor in the walk-in garden, as data (#324): its art, where it
// sits today, and how it acts. One pure file per kind (no three, no DOM, no
// clock), listed once in kinds/index.ts. The runtime (sceneVisitors.ts) owns
// the sprites, picking, tags and speech bubbles, and draws each visitor's Body
// every frame. Kinds never refer to each other: they meet only through Spots
// and Conditions.

import type { Conditions } from "../conditions";
import type { Frame } from "../scenePart";
import type { Spots } from "../spots";
import type { PixelArt } from "../visitorArt";
import type { VisitorId } from "../visitors";
import type { Layout } from "../world";

/** Its word's plant (#235), for a garden-word visitor whose plant is in the garden. */
export interface Home {
  x: number;
  z: number;
  /** The height of the bed's soil (m). */
  soil: number;
  /** The height of the top of the plant, as its sprite draws it (m). */
  top: number;
  /** It droops for water: a visitor on top sits lower, by its stem. */
  thirsty: boolean;
}

/** What a visitor is told when it arrives, as the garden is built. */
export interface Arrival {
  spots: Spots;
  layout: Layout;
  /** Its word's plant, or null when it has none (no garden word, or the word was set aside). */
  home: Home | null;
  /** The moment the walk opened: daily picks use its calendar day. */
  now: Date;
  reducedMotion: boolean;
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
}

/** A tap that a visitor may answer. */
export interface Tap {
  elapsed: number;
  /** Words the learner knows, in the course language. */
  known: readonly string[];
  lang: string;
}

/** You whistled (#377). */
export interface Call {
  elapsed: number;
  /** Where you stand. */
  x: number;
  z: number;
  lang: string;
}

/** A visitor's answer to a call: what a screen reader hears (one short sentence), and what it says in a bubble, if anything. */
export interface Heard {
  line: string;
  say?: string;
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
  /** Its answer to a tap, said in a bubble instead of its tag; null shows its tag as usual. */
  onTap?(t: Tap): string | null;
  /**
   * The scene moved it (visit): settle there, whatever it was doing.
   * `settled`: it sits with you on the bench (#362), so it does not mind you near.
   */
  onVisit?(settled: boolean): void;
  /** Something lands in the pond (#358). True when it answers (and so the walk says so). */
  onSplash?(): boolean;
  /** A lantern was blown out or lit again (#361), `on` by spot (Spots.lanterns). What it says about it, or null. */
  onLanterns?(on: readonly boolean[]): string | null;
  /** You whistled (#377): it answers in its own way (its Body moves in the next steps), or null when it does not. Asked only while it is seen. */
  onCall?(c: Call): Heard | null;
}

export interface VisitorKind<F extends string = string> {
  id: VisitorId;
  /** Its frames in the shared visitor atlas (32×32 cells, standing on the bottom row). */
  art: Record<F, PixelArt>;
  /** The drawn part: its middle height and half width and height, as fractions of the cell. Default [0.2, 0.4, 0.3]. */
  hit?: [number, number, number];
  /** Where its tag sits, as a fraction of the cell's height. Default 0.55. */
  top?: number;
  /** How near you come before its tag shows, for an "approach" tag (m). Default 1.5. */
  tagRange?: number;
  /** It lies flat, seen from above (the fish), showing the rows its art fills at the bottom of the cell. */
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
  return { at: { x, y, z }, x, y, z, frame, visible: true, turn: 0, tag: 1, glow: false, mute: false };
}

/** Within this far of its spot (m), a visitor walking off it comes down to the ground (its spot may be up on a bed or the bench). */
const STEP_DOWN = 0.5;

/**
 * Moves a body's drawn place toward (x, z) on the ground by `d` metres
 * (Infinity: there at once), coming down from its spot as it leaves and going
 * back up as it comes home. True once it is there.
 */
export function moveToward(body: Body<string>, x: number, z: number, d: number): boolean {
  const gap = Math.hypot(x - body.x, z - body.z);
  const k = gap <= d ? 1 : d / gap;
  body.x += (x - body.x) * k;
  body.z += (z - body.z) * k;
  body.y = body.at.y * Math.max(0, 1 - Math.hypot(body.x - body.at.x, body.z - body.at.z) / STEP_DOWN);
  return k === 1;
}

/** Where a visitor called over to you stops: `gap` metres from you (x, z), on its side of you. */
export function besideYou(body: Body<string>, x: number, z: number, gap: number): { x: number; z: number } {
  const d = Math.max(0.01, Math.hypot(body.x - x, body.z - z));
  const k = Math.min(1, gap / d);
  return { x: x + (body.x - x) * k, z: z + (body.z - z) * k };
}
