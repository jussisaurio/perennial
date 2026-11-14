// What is in reach, and what the one action button does (#334, #850, #975):
// the rules, with no three.js, no window and no clock. The game (game.ts)
// asks every step what the button offers from where the walker stands, shows
// that, and does what a press gives back; a test asks the same with a walker
// and plain things. The walker is walker.ts's; the plant ahead is shake.ts's.

import { REACH_SLACK } from "./reach";
import { plantInReach } from "./shake";
import { DIARY_REACH, STOOL_REACH, type Lookout } from "./lookout";
import type { Walker } from "./walker";
import type { PlacedPlant } from "./world";
import type { VisitorId } from "./visitors";
import type { CarryAct, CarryTarget } from "./carry";
import type { ToyAct, ToyTarget } from "./toys";

/** What the learner can do at the door: try it while it is locked, pick up the key, or open the door with the key. */
export type DoorAction = "try" | "key" | "open";
/** What the one action button does to the thing in reach (#334): the door's actions, sit on the bench and stand up again, shake a plant (#357), carry's (#358), the toys' (#360), blow a lantern out and light it again (#361), or find the gnome where it hides (#379), or read a note in the shed (#654), or sit on the lookout's stool and read the diary there (#858). */
export type Reach = DoorAction | "sit" | "stand" | "shake" | CarryAct | ToyAct | "snuff" | "light" | "seek" | "read" | "stool" | "diary";

/**
 * The action button (#334) shows only an icon, which changes shape with what it
 * does: you find out by pressing it. A screen reader hears what it does, said
 * plainly: mystery must not lock anyone out.
 */
export const REACH_NAME: Record<Reach, string> = {
  try: "Try the door",
  key: "Pick up the key",
  open: "Open the door with the key",
  sit: "Sit on the bench",
  stand: "Stand up",
  shake: "Shake the plant",
  "lift-pebble": "Pick up the pebble",
  throw: "Throw it",
  blow: "Blow the dandelion",
  snuff: "Blow out the lantern",
  light: "Light the lantern",
  well: "Drop it in the well",
  seek: "Found you",
  read: "Read the note",
  stool: "Sit on the stool",
  diary: "Read the diary",
};

/** Near enough to the bench (m, from its middle) to sit on it (#334). */
const BENCH_REACH = 1.6;
/** Near enough to the door (metres from its middle) to be offered its button. */
const DOOR_REACH = 2.6;
/** Near enough to the hidden key to be offered "Pick up the key" (m). @internal Exported for tests: e2e/helpers.ts stands by the key with it. */
export const KEY_REACH = 2;
/** Near enough to a lantern (m) to blow it out or light it. */
export const LANTERN_REACH = 1.5;

/** The lanterns (lanterns.ts Lamps): where each stands ([x, y, z]), which are lit when it is dark, and the lookout's by its index (-1: none). */
interface LanternsNow {
  readonly at: readonly (readonly [number, number, number])[];
  readonly on: readonly boolean[];
  readonly dark: boolean;
  readonly lookout: number;
}

/**
 * The things the button can act on, as the game (game.ts) keeps them. The
 * first six are plain data, and their rules are here. The rest answer for
 * themselves, and only the order they come in is here.
 */
export interface Things {
  /** The door in the hedge (game.ts DoorNow): "key" while its key lies in the garden, at `key`. */
  door: { readonly state: "locked" | "key" | "held" | "open"; readonly key: { x: number; z: number } | null };
  /** The door's middle. */
  gate: { x: number; z: number };
  /** The pond's bench, by its middle (world.ts benchAt). */
  bench: { x: number; z: number };
  lanterns: LanternsNow;
  /** The hill's lookout and the diary's pages (lookout.ts Diary); null while there is no stile. */
  lookout: { readonly hill: Lookout; readonly pages: readonly unknown[] } | null;
  plants: readonly PlacedPlant[];
  /** The pebbles (carry.ts Pebbles): `held` is not null while one is in your hands. */
  carry: { readonly held: unknown; reachAt(x: number, z: number, held: CarryTarget | null): { a: CarryAct; target: CarryTarget | null } | null };
  /** The dandelion clocks (toys.ts Clocks). */
  toys: { reachAt(x: number, z: number, held: ToyTarget | null): { a: ToyAct; target: ToyTarget } | null };
  /** The visitors (game.ts Guests): one hiding within reach (#379). */
  hiders: { hiderNear(x: number, z: number, held: VisitorId | null): VisitorId | null };
  /** The last note on the mouse door's mat (#882, mouseDoor.ts). */
  mat: { noteInReach(x: number, z: number, slack: number): string | null };
  /** A note in the shed that you look at, or one at the stile's foot (#654), `slack` m farther than its reach. */
  note(x: number, z: number, yaw: number, pitch: number, slack: number): string | null;
}

/**
 * What the button offers: what it does (`a`), to which thing (`on`), and to
 * which one of them (`target`). On a seat it gets you up (target null), or on
 * the stool blows out or lights the lantern beside you (its index).
 */
export type Offer =
  | { on: "seat"; a: "stand"; target: null }
  | { on: "seat" | "lantern"; a: "snuff" | "light"; target: number }
  | { on: "key"; a: "key"; target: null }
  | { on: "door"; a: "try" | "open"; target: null }
  | { on: "carry"; a: CarryAct; target: CarryTarget | null }
  | { on: "hider"; a: "seek"; target: VisitorId }
  | { on: "mat" | "note"; a: "read"; target: string }
  | { on: "stool"; a: "stool"; target: null }
  | { on: "diary"; a: "diary"; target: null }
  | { on: "bench"; a: "sit"; target: null }
  | { on: "toy"; a: ToyAct; target: ToyTarget }
  | { on: "plant"; a: "shake"; target: PlacedPlant };

// Made once: these are asked for every frame.
const STAND: Offer = { on: "seat", a: "stand", target: null };
const KEY: Offer = { on: "key", a: "key", target: null };
const TRY: Offer = { on: "door", a: "try", target: null };
const OPEN: Offer = { on: "door", a: "open", target: null };
const STOOL: Offer = { on: "stool", a: "stool", target: null };
const DIARY: Offer = { on: "diary", a: "diary", target: null };
const SIT: Offer = { on: "bench", a: "sit", target: null };

/** How much farther (m) a thing counts as in reach: REACH_SLACK while the button shows one of `acts` now, none for anything else (#838). */
function slack(shown: Offer | null, ...acts: Reach[]): number {
  return shown && acts.includes(shown.a) ? REACH_SLACK : 0;
}

/** Is (x, z) near enough (and `slack` m more) to the key (for "key") or the door (the rest) to act on it? */
export function doorInReach(t: Pick<Things, "door" | "gate">, x: number, z: number, a: DoorAction, slack: number): boolean {
  const k = t.door.key;
  if (a === "key") return !!k && Math.hypot(x - k.x, z - k.z) < KEY_REACH + slack;
  return Math.hypot(x - t.gate.x, z - t.gate.z) < DOOR_REACH + slack;
}

/** The lantern nearest (x, z) in reach while it is dark, or -1; the one the button shows now (`held`, or -1) stays in reach REACH_SLACK farther (#838). Runs every frame: no allocation. */
function lanternInReach(l: LanternsNow, x: number, z: number, held: number): number {
  if (!l.dark) return -1;
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < l.at.length; i++) {
    const d = Math.hypot(l.at[i][0] - x, l.at[i][2] - z);
    if (d < bestD && d < LANTERN_REACH + (i === held ? REACH_SLACK : 0)) [best, bestD] = [i, d];
  }
  return best;
}

/** The lantern in reach while they are lit (#361), by spot, or -1. */
function lampInReach(w: Walker, t: Things, shown: Offer | null): number {
  // -1: the button shows no lantern now.
  return lanternInReach(t.lanterns, w.x, w.z, shown?.on === "lantern" ? shown.target : -1);
}

/** Near enough (and `slack` m more) to the diary's stone to read it, while there is a diary. */
export function byDiary(lookout: NonNullable<Things["lookout"]>, x: number, z: number, slack: number): boolean {
  return lookout.pages.length > 0 && Math.hypot(lookout.hill.stone[0] - x, lookout.hill.stone[1] - z) < DIARY_REACH + slack;
}

type Finder = (w: Walker, t: Things, shown: Offer | null) => Offer | null;

const seat: Finder = (w, t) => {
  if (w.mode.kind !== "seated") return null;
  // -1: by day the lookout's lantern is not lit, and the bench has none.
  const i = w.mode.on === "stool" && t.lanterns.dark ? t.lanterns.lookout : -1;
  return i < 0 ? STAND : { on: "seat", a: t.lanterns.on[i] ? "snuff" : "light", target: i };
};

const key: Finder = (w, t, shown) => (t.door.state === "key" && doorInReach(t, w.x, w.z, "key", slack(shown, "key")) ? KEY : null);

/** A loose thing (#358): one in your hands (`holding`) is thrown, or dropped in the well; with your hands free, one in reach is picked up. */
const carry =
  (holding: boolean): Finder =>
  (w, t, shown) => {
    if ((t.carry.held !== null) !== holding) return null;
    // Carry.reachAt gives back one object it keeps: read it now.
    const got = t.carry.reachAt(w.x, w.z, shown?.on === "carry" ? shown.target : null);
    return got && { on: "carry", a: got.a, target: got.target };
  };

const hider: Finder = (w, t, shown) => {
  const id = t.hiders.hiderNear(w.x, w.z, shown?.on === "hider" ? shown.target : null);
  return id ? { on: "hider", a: "seek", target: id } : null;
};

const mat: Finder = (w, t, shown) => {
  const id = t.mat.noteInReach(w.x, w.z, slack(shown, "read"));
  return id ? { on: "mat", a: "read", target: id } : null;
};

const door: Finder = (w, t, shown) => {
  if (t.door.state === "open" || !doorInReach(t, w.x, w.z, "try", slack(shown, "try", "open"))) return null;
  // The two lanterns by the gate stand in the door's reach: whichever is nearer comes first.
  const lamp = lampInReach(w, t, shown);
  if (lamp >= 0 && Math.hypot(w.x - t.gate.x, w.z - t.gate.z) > Math.hypot(t.lanterns.at[lamp][0] - w.x, t.lanterns.at[lamp][2] - w.z)) return null;
  return t.door.state === "held" ? OPEN : TRY;
};

const stool: Finder = (w, t, shown) => (t.lookout && Math.hypot(t.lookout.hill.stool[0] - w.x, t.lookout.hill.stool[1] - w.z) < STOOL_REACH + slack(shown, "stool") ? STOOL : null);

const diary: Finder = (w, t, shown) => (t.lookout && byDiary(t.lookout, w.x, w.z, slack(shown, "diary")) ? DIARY : null);

const lantern: Finder = (w, t, shown) => {
  const i = lampInReach(w, t, shown);
  return i < 0 ? null : { on: "lantern", a: t.lanterns.on[i] ? "snuff" : "light", target: i };
};

const note: Finder = (w, t, shown) => {
  const id = t.note(w.x, w.z, w.yaw, w.pitch, slack(shown, "read"));
  return id ? { on: "note", a: "read", target: id } : null;
};

const bench: Finder = (w, t, shown) => (Math.hypot(w.x - t.bench.x, w.z - t.bench.z) < BENCH_REACH + slack(shown, "sit") ? SIT : null);

const toy: Finder = (w, t, shown) => {
  // Toys.reachAt gives back one object it keeps: read it now.
  const got = t.toys.reachAt(w.x, w.z, shown?.on === "toy" ? shown.target : null);
  return got && { on: "toy", a: got.a, target: got.target };
};

const plant: Finder = (w, t, shown) => {
  const p = plantInReach(t.plants, w.x, w.z, w.yaw, shown?.on === "plant" ? shown.target : null);
  return p && { on: "plant", a: "shake", target: p };
};

/**
 * Everything the action button can act on (#334, #850), in the order it
 * chooses: the first in reach wins. On the bench it only gets you up; on
 * the lookout's stool it blows out or lights the lantern beside you while
 * they are lit, else gets you up (#858); then the key; a loose thing in your
 * hands; a hiding visitor (#379), before the bench and the plant ahead: it
 * hides under the one and behind the other; the last note on the mouse
 * door's mat (#882), which lies in the door's reach; the door, unless a lantern by
 * the gate is nearer; the lookout's stool, then its diary, before the
 * lantern on the post a step in front of the stool; a lantern; a
 * note (#654) in the shed or at the stile's foot; a loose thing to pick up;
 * the bench; a dandelion clock (#360); last the plant ahead of you (#357).
 */
const ORDER: readonly Finder[] = [seat, key, carry(true), hider, mat, door, stool, diary, lantern, note, carry(false), bench, toy, plant];

/**
 * What the action button does from where the walker stands: the first thing
 * in ORDER in reach. With nothing in reach, null: no button (#835). `shown`
 * is what it showed the frame before: only that thing stays in reach
 * REACH_SLACK farther (#838).
 */
export function offerAt(w: Walker, t: Things, shown: Offer | null): Offer | null {
  for (const find of ORDER) {
    const got = find(w, t, shown);
    if (got) return got;
  }
  return null;
}

/** Everything in reach, in the button's order: the first is what it does now, the rest what it would do if that were gone. */
export function offersAt(w: Walker, t: Things, shown: Offer | null): Offer[] {
  return ORDER.flatMap((find) => find(w, t, shown) ?? []);
}

/** The same action on the same one thing? Targets are made once (Carry.reachAt, Toys.reachAt), so the same target is the same object. */
export function same(a: Offer | null, b: Offer | null): boolean {
  if (a === null || b === null) return a === b;
  return a.on === b.on && a.a === b.a && a.target === b.target;
}

/**
 * A press on the button while it said `a`: what to do, or null for nothing.
 * It does what the button shows (`shown`). A press that comes before the
 * button caught up with a change in reach no longer matches what it shows: the
 * bench and the door check their own state, so they act all the same;
 * anything else no longer applies. You can't sit down while you sit.
 */
export function press(a: Reach, shown: Offer | null, w: Walker): Offer | null {
  const seated = w.mode.kind === "seated";
  if (shown && a === shown.a) return seated && (shown.on === "bench" || shown.on === "stool") ? null : shown;
  if (a === "sit") return seated ? null : SIT;
  if (a === "stand") return seated ? STAND : null;
  if (a === "key") return KEY;
  if (a === "try") return TRY;
  if (a === "open") return OPEN;
  return null;
}
