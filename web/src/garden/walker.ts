// The walker (#975): where the learner stands in the walk-in garden, which way
// they look, and what they are doing (free, on a walk, on a glide, seated), with
// one function that steps it by a frame. No three.js, no window and no clock:
// the scene (scene.ts) passes the frame's seconds in and draws what this says,
// and a test steps it with a fixed dt. Collisions and ways on foot are
// world.ts's and ground.ts's; this is what holds them together each frame.

import { standAt, wayNear, type Ground } from "./ground";
import { STOOL_R, type Lookout } from "./lookout";
import { stepY, type StileSpot } from "./stile";
import { along, BENCH, benchAt, route, walk, WALKER, walkStep, type Trip } from "./world";

export interface Input {
  /** -1..1 each: forward and right, from keys or the touch stick. */
  move: { x: number; y: number };
  run: boolean;
}

/** Walking speed (m/s). */
const WALK = 3.6;
/** On the stile's steps (#770), a walk goes this much of its pace: you climb. */
const STEPS_PACE = 0.6;
/** Sitting on the bench (#334): the eye's height, where you sit along the seat (near its left end: the rest is for company, #362), and how fast you sit down (per second). */
export const SEAT = { eye: 0.78, dx: -0.5, speed: 2.5 };
/** How fast the view turns toward where a walk goes: the share of the turn left that it makes per second. */
const TRIP_TURN = 3;

/** The bench by the pond (#334) or the lookout's stool (#858). */
export type Seat = "bench" | "stool";

/**
 * What the walker is doing (#877), one at a time:
 * - free: standing, or walking with the keys;
 * - trip: a walk to a tapped spot (#336, world.ts Trip and walkStep). It turns the view gently toward where
 *   it goes while `turn` (never with reduced motion, and no more once the viewer looks round themselves).
 *   On arrival the scene does `then` (a plant's card, the door);
 * - glide: to a plant along `path` (world.ts route), turning from one yaw and pitch to the other, `t` 0 to 1 over `s` seconds;
 * - seated: on the bench or the stool. Any move stands you up.
 */
export type Mode =
  | { kind: "free" }
  | ({ kind: "trip"; then: (() => void) | null; turn: boolean } & Trip)
  | { kind: "glide"; path: [number, number][]; yaw: [number, number]; pitch: [number, number]; t: number; s: number }
  | { kind: "seated"; on: Seat };

/** One for all: the frame loop goes back to free without making a new object. */
export const FREE: Mode = { kind: "free" };

/** The walker. Every function here changes it in place: the frame loop makes no new objects. */
export interface Walker {
  /** Where they stand (world.ts's metres) and where they look (radians; forward is -z at yaw 0). */
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  /** The step's phase, for the view's bob. */
  bob: number;
  /** How far sat down: 0 standing, 1 seated; the eye sinks and rises between them. */
  seat: number;
  mode: Mode;
}

/** What the walker walks in. The ground reads the door and the trees as they are now. */
export interface WalkerWorld {
  ground: Ground;
  /** The stile and the hill's lookout (#770, #858): null until the stile is there. */
  stile: StileSpot | null;
  hill: Lookout | null;
  reducedMotion: boolean;
}

/** How a walk to a tapped spot ended this frame: there (the scene then does `then`), or held by something its way did not plan round. */
export type TripEnd = { end: "arrived"; then: (() => void) | null } | { end: "stalled" };

const STALLED: TripEnd = { end: "stalled" };

export function newWalker(x: number, z: number): Walker {
  return { x, z, yaw: 0, pitch: -0.2, bob: 0, seat: 0, mode: FREE };
}

/**
 * The one way the walker's mode changes (#877). Returns the mode left, for
 * what the scene shows on leaving it and entering the new one. Moving with
 * the keys calls it every frame, so going from free to free does nothing and
 * makes nothing new.
 */
export function toMode(w: Walker, next: Mode, world: WalkerWorld): Mode {
  const was = w.mode;
  w.mode = next;
  // Up off a seat, a step the way it faces: the stool and the bench are solid (#1011), and a walk starts where a walker may stand.
  if (was.kind === "seated" && was.on === "stool") {
    // Toward the far house. The stool is there whenever you sat on it.
    const h = world.hill!;
    const out = STOOL_R + WALKER + 0.01;
    [w.x, w.z] = [h.stool[0] - Math.sin(h.face) * out, h.stool[1] - Math.cos(h.face) * out];
  } else if (was.kind === "seated" && was.on === "bench") {
    // Toward the pond, straight out from where you sat.
    w.z = benchAt(world.ground.layout).z + BENCH.front + WALKER + 0.01;
  }
  return was;
}

/**
 * Sit on the bench, facing the pond, or on the lookout's stool (#858),
 * facing the far house: a cut to the seat, and the eye sinks (at once, with
 * reduced motion). Any move stands you up. Returns the mode left.
 */
export function sit(w: Walker, on: Seat, world: WalkerWorld): Mode {
  if (on === "stool") {
    // The stool is there whenever the button offers it.
    const h = world.hill!;
    [w.x, w.z, w.yaw, w.pitch] = [h.stool[0], h.stool[1], h.face, 0];
  } else {
    const b = benchAt(world.ground.layout);
    // The bench faces +z, toward the pond; forward is -z at yaw 0.
    [w.x, w.z, w.yaw, w.pitch] = [b.x + SEAT.dx, b.z + 0.05, Math.PI, 0.1];
  }
  return toMode(w, { kind: "seated", on }, world);
}

/** The viewer looks where they like now: a glide stops; a walk goes on, but no longer turns the view. */
function lookRound(w: Walker, world: WalkerWorld) {
  const m = w.mode;
  if (m.kind === "glide") toMode(w, FREE, world);
  else if (m.kind === "trip") m.turn = false;
}

/** A drag (pixels) turns the view. */
export function look(w: Walker, dx: number, dy: number, world: WalkerWorld) {
  lookRound(w, world);
  w.yaw -= dx * 0.0055;
  w.pitch = Math.max(-0.75, Math.min(0.5, w.pitch - dy * 0.004));
}

export function turn(w: Walker, amount: number, world: WalkerWorld) {
  lookRound(w, world);
  w.yaw += amount;
}

/** Walk straight ahead (or back, if negative) by `metres`. Returns the mode left. */
export function stepAhead(w: Walker, metres: number, world: WalkerWorld): Mode {
  const was = toMode(w, FREE, world);
  const g = world.ground;
  ({ x: w.x, z: w.z } = walk(g.layout, w.x, w.z, w.x - Math.sin(w.yaw) * metres, w.z - Math.cos(w.yaw) * metres, g.doorOpen(), g.trees(), g.back));
  return was;
}

/**
 * Start a walk round whatever is in the way to (x, z), or as near as a walker
 * may stand, to stop `stop` m short; the scene does `then` on arrival.
 * Returns the mode left, and where the walk goes.
 */
export function startTrip(w: Walker, x: number, z: number, stop: number, then: (() => void) | null, world: WalkerWorld): { was: Mode; to: { x: number; z: number } } {
  const g = world.ground;
  // A glide (Next plant) passes over beds; a tap during one starts from where a walker would stand.
  ({ x: w.x, z: w.z } = standAt(g, w.x, w.z));
  // Standing up off a seat steps you off it: the way starts from there.
  const was = toMode(w, FREE, world);
  const to = standAt(g, x, z);
  toMode(w, { kind: "trip", way: wayNear(g, w.x, w.z, to.x, to.z, 0), leg: 1, stop, then, turn: !world.reducedMotion, stuck: 0 }, world);
  return { was, to };
}

/**
 * Go to (x, z) to face `yaw` and `pitch` there (Next plant, or the end of a
 * walk to a plant): a short glide along world.ts's route, turning the short
 * way round; a cut, with reduced motion. Returns the mode left.
 */
export function glideTo(w: Walker, x: number, z: number, yaw: number, pitch: number, world: WalkerWorld): Mode {
  const was = toMode(w, FREE, world);
  // Turn the short way round.
  while (yaw - w.yaw > Math.PI) yaw -= Math.PI * 2;
  while (yaw - w.yaw < -Math.PI) yaw += Math.PI * 2;
  if (world.reducedMotion) {
    [w.x, w.z, w.yaw, w.pitch] = [x, z, yaw, pitch];
  } else {
    // From the orchard, out through the door (#315): a longer way, so a little longer.
    const path = route(world.ground.layout, w.x, w.z, x, z, world.ground.back);
    toMode(w, { kind: "glide", path, yaw: [w.yaw, yaw], pitch: [w.pitch, pitch], t: 0, s: path.length > 2 ? 1.8 : 0.9 }, world);
  }
  return was;
}

/** How fast a walk goes now, as a share of WALK: slower on the stile's steps (#770). */
function pace(w: Walker, world: WalkerWorld): number {
  return world.stile && stepY(world.stile, w.x, w.z) > 0 ? STEPS_PACE : 1;
}

/**
 * One frame of a walk (#336): toward the next corner at walking speed (world.ts walkStep).
 * The view turns gently toward where it goes; with reduced motion it keeps still, and the walk moves at an even pace.
 */
function walkOn(w: Walker, trip: Mode & { kind: "trip" }, dt: number, world: WalkerWorld): TripEnd | null {
  const g = world.ground;
  // walkStep moves the walker itself: it reads and writes only x and z.
  const now = walkStep(g.layout, trip, w, WALK * pace(w, world) * dt, dt, g.doorOpen(), g.trees(), g.back);
  if (now === "arrived") {
    toMode(w, FREE, world);
    return { end: "arrived", then: trip.then };
  }
  if (now === "stalled") {
    toMode(w, FREE, world);
    return STALLED;
  }
  w.bob += dt * WALK * 3.2;
  const [cx, cz] = trip.way[trip.leg];
  if (trip.turn && trip.stuck === 0) {
    // Forward is -z at yaw 0; turn the short way round.
    let d = Math.atan2(-(cx - w.x), -(cz - w.z)) - w.yaw;
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
    w.yaw += d * Math.min(1, dt * TRIP_TURN);
  }
  return null;
}

/** One frame of a walk or a glide under way. */
function moveOn(w: Walker, dt: number, world: WalkerWorld): TripEnd | null {
  const m = w.mode;
  switch (m.kind) {
    case "free":
    case "seated":
      return null;
    case "trip":
      return walkOn(w, m, dt, world);
    case "glide": {
      m.t = Math.min(1, m.t + dt / m.s);
      const e = m.t < 0.5 ? 2 * m.t * m.t : 1 - (-2 * m.t + 2) ** 2 / 2;
      ({ x: w.x, z: w.z } = along(m.path, e));
      w.yaw = m.yaw[0] + (m.yaw[1] - m.yaw[0]) * e;
      w.pitch = m.pitch[0] + (m.pitch[1] - m.pitch[0]) * e;
      if (m.t >= 1) toMode(w, FREE, world);
      return null;
    }
    default:
      return m satisfies never;
  }
}

/**
 * One frame of the walker, `dt` seconds long: held keys or the stick walk
 * (and stand you up, and take over from a walk or a glide); else a walk or a
 * glide under way goes on; then the eye sinks toward the seat or rises from
 * it. Returns how a walk to a tapped spot ended, if it ended this frame.
 */
export function step(w: Walker, input: Input, dt: number, world: WalkerWorld): TripEnd | null {
  // Walking: forward is -z at yaw 0.
  const { move, run } = input;
  const len = Math.hypot(move.x, move.y);
  if (len > 0.01) {
    toMode(w, FREE, world);
    const speed = WALK * (run ? 2 : 1) * pace(w, world) * Math.min(1, len);
    const fx = -Math.sin(w.yaw);
    const fz = -Math.cos(w.yaw);
    const nx = w.x + ((fx * move.y + -fz * move.x) / Math.max(1, len)) * speed * dt;
    const nz = w.z + ((fz * move.y + fx * move.x) / Math.max(1, len)) * speed * dt;
    const g = world.ground;
    ({ x: w.x, z: w.z } = walk(g.layout, w.x, w.z, nx, nz, g.doorOpen(), g.trees(), g.back));
    w.bob += dt * speed * 3.2;
  }
  const end = moveOn(w, dt, world);
  // Sitting down or standing up: the eye sinks or rises over a moment (at once, with reduced motion).
  const sat = w.mode.kind === "seated" ? 1 : 0;
  w.seat = world.reducedMotion ? sat : w.seat + Math.max(-dt * SEAT.speed, Math.min(dt * SEAT.speed, sat - w.seat));
  return end;
}
