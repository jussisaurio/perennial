import { describe, expect, test } from "bun:test";
import { backWay, CUT, HILLTOP_R, lookoutAt, PATH_TURN, STOOL_R } from "./lookout";
import { BRAMBLES_IN, STEP, stileAt } from "./stile";
import { FREE, newWalker, sit, startTrip, step, toMode, type Input, type Walker, type WalkerWorld } from "./walker";
import { BENCH, benchAt, collide, layout, WALKER, type GardenPlant } from "./world";

// The claims of docs/garden-play.md that are about where the walker may go,
// played on the walker alone (#975): the same keys held for the same seconds as
// the e2e tests of the same names, at a fixed 60 frames a second.

const DT = 1 / 60;
const DAY = 86_400_000;
const plant = (i: number): GardenPlant => ({
  id: `w${i}`,
  lemma: `word${i}`,
  gloss: "",
  pos: "noun",
  rank: i,
  planted: Math.floor(i / 6) * DAY,
  s: 10,
  r: 0.95,
  stage: "bloom",
  growth: 0.5,
  listen: false,
  write: false,
  forms: [],
});
const L = layout(Array.from({ length: 40 }, (_, i) => plant(i)));
const STILE = stileAt(L);
const HILL = lookoutAt(STILE);

/** The garden with its stile: the way over it shut by brambles (before note n08) or open. The door in the hedge is shut. */
function world(way: "shut" | "open", reducedMotion = false): WalkerWorld {
  return { ground: { layout: L, doorOpen: () => false, trees: () => [], back: backWay(STILE, HILL, way === "open") }, stile: STILE, hill: HILL, reducedMotion };
}

const KEYS = { KeyW: { x: 0, y: 1 }, KeyD: { x: 1, y: 0 } } as const;
const NONE: Input = { move: { x: 0, y: 0 }, run: false };

function stand(x: number, z: number, yaw: number): Walker {
  return Object.assign(newWalker(x, z), { yaw });
}

/** Hold a key for `s` seconds, or until `until` holds. Returns whether it came to hold. */
function hold(w: Walker, key: keyof typeof KEYS, s: number, wd: WalkerWorld, until: () => boolean = () => false): boolean {
  for (let t = 0; t < s; t += DT) {
    if (until()) return true;
    step(w, { move: KEYS[key], run: false }, DT, wd);
  }
  return until();
}

/** `s` seconds with no key held. */
function wait(w: Walker, s: number, wd: WalkerWorld) {
  for (let t = 0; t < s; t += DT) step(w, NONE, DT, wd);
}

describe("walking into something solid stops you", () => {
  test("fence.solid: walking with W into the back fence away from the stile stops you at the fence", () => {
    const wd = world("open");
    const w = stand(STILE.x + 2.5, STILE.z + 1.5, 0);
    hold(w, "KeyW", 1.5, wd);
    expect(w.z).toBeCloseTo(STILE.z + WALKER, 6);
    expect(w.x).toBeCloseTo(STILE.x + 2.5, 6);
  });

  test("stile.sides-solid: with n08, the stile stops you along the fence, and a rail stops you on the steps", () => {
    const wd = world("open");
    // Along the back fence toward the stile, with D (+x).
    let w = stand(STILE.x - 2, STILE.z + WALKER + 0.05, 0);
    hold(w, "KeyD", 1.5, wd);
    expect(w.x).toBeCloseTo(STILE.x - STEP.w / 2 - WALKER, 6);
    // On the steps, with D: the rail.
    w = stand(STILE.x, STILE.z + 0.3, 0);
    hold(w, "KeyD", 1, wd);
    expect(w.x).toBeCloseTo(STILE.x + STEP.w / 2 - WALKER, 6);
    expect(w.z).toBeCloseTo(STILE.z + 0.3, 6);
  });

  test("hill.brambles: on the cut way and on the hilltop, walking into the brambles stops you", () => {
    const wd = world("open");
    let w = stand(HILL.top[0], HILL.top[1], 0);
    hold(w, "KeyW", 2.5, wd);
    expect(Math.hypot(w.x - HILL.top[0], w.z - HILL.top[1])).toBeCloseTo(HILLTOP_R - WALKER, 6);
    // On the cut way, 3 m past the fence, walking square to it, to the left.
    const [dx, dz] = [-Math.sin(PATH_TURN), -Math.cos(PATH_TURN)];
    const [mx, mz] = [STILE.x + dx * 3, STILE.z + dz * 3];
    w = stand(mx, mz, PATH_TURN + Math.PI / 2);
    hold(w, "KeyW", 1.5, wd);
    // How far it went across the way: its left is (dz, −dx).
    expect((w.x - mx) * dz - (w.z - mz) * dx).toBeCloseTo(CUT - WALKER, 6);
  });

  test("bench.solid: walking with W into the bench stops you at it: from the garden behind it, at its end, and from the pond's side", () => {
    const wd = world("shut");
    const b = benchAt(L);
    // From the garden, facing the pond: +z is yaw π.
    let w = stand(b.x, b.z - 1.5, Math.PI);
    hold(w, "KeyW", 1.5, wd);
    expect(w.z).toBeCloseTo(b.z - BENCH.back - WALKER, 6);
    expect(w.x).toBeCloseTo(b.x, 6);
    // Along it, into its right end (its left has the sundial, #1019): -x is yaw π/2.
    w = stand(b.x + 2, b.z, Math.PI / 2);
    hold(w, "KeyW", 1.5, wd);
    expect(w.x).toBeCloseTo(b.x + BENCH.half + WALKER, 6);
    expect(w.z).toBeCloseTo(b.z, 6);
    // Between it and the pond, turned to it.
    w = stand(b.x, b.z + BENCH.front + WALKER + 0.05, 0);
    hold(w, "KeyW", 1, wd);
    expect(w.z).toBeCloseTo(b.z + BENCH.front + WALKER, 6);
  });
});

describe("you can walk wherever there is ground", () => {
  test("stile.walk-over, stile.stop-on-steps: with n08, holding W takes you over the stile; let go on the top board and you stay there", () => {
    const wd = world("open");
    const w = stand(STILE.x, STILE.foot[1], 0);
    // To the top board, and let go.
    expect(hold(w, "KeyW", 20, wd, () => w.z < STILE.z + 0.15)).toBe(true);
    expect(Math.abs(w.z - STILE.z)).toBeLessThan(STEP.out);
    const top = { x: w.x, z: w.z };
    wait(w, 2, wd);
    expect({ x: w.x, z: w.z }).toEqual(top);
    // On, and down past the fence.
    expect(hold(w, "KeyW", 20, wd, () => w.z < STILE.z - STEP.out - 0.3)).toBe(true);
  });
});

describe("sitting and standing", () => {
  test("hill.sit: sitting on the stool seats you on it, facing the far house; W stands you up, clear of the stool", () => {
    const wd = world("open");
    // Behind the stool, turned away from the far house: sitting turns you to it.
    const w = stand(HILL.stool[0] + Math.sin(HILL.face) * 0.6, HILL.stool[1] + Math.cos(HILL.face) * 0.6, HILL.face + 1);
    sit(w, "stool", wd);
    expect(w.mode).toEqual({ kind: "seated", on: "stool" });
    expect([w.x, w.z]).toEqual(HILL.stool);
    expect(w.yaw).toBe(HILL.face);
    // The eye sinks over a moment, and you stay sat while no key is held.
    wait(w, 1, wd);
    expect(w.seat).toBe(1);
    expect(w.mode.kind).toBe("seated");
    hold(w, "KeyW", 0.3, wd);
    expect(w.mode).toBe(FREE);
    expect(w.seat).toBeLessThan(1);
    // The stool is solid: you stand where a walker may stand.
    expect(Math.hypot(w.x - HILL.stool[0], w.z - HILL.stool[1])).toBeGreaterThanOrEqual(STOOL_R + WALKER);
    expect(collide(L, w.x, w.z, WALKER, false, wd.ground.back)).toEqual({ x: w.x, z: w.z });
  });

  test("standing up from the stool with the button puts you a step in front of it, toward the far house", () => {
    const wd = world("open");
    const w = stand(HILL.stool[0], HILL.stool[1] + 0.6, 0);
    sit(w, "stool", wd);
    toMode(w, FREE, wd);
    const out = STOOL_R + WALKER + 0.01;
    // Forward is -z at yaw 0.
    expect(w.x).toBeCloseTo(HILL.stool[0] - Math.sin(HILL.face) * out, 9);
    expect(w.z).toBeCloseTo(HILL.stool[1] - Math.cos(HILL.face) * out, 9);
    expect(collide(L, w.x, w.z, WALKER, false, wd.ground.back)).toEqual({ x: w.x, z: w.z });
  });

  test("the bench seats you facing the pond; a step stands you up again, clear of the bench", () => {
    const wd = world("shut");
    const b = benchAt(L);
    // From the garden behind it, as you come to it.
    const w = stand(b.x, b.z - 1, 0);
    sit(w, "bench", wd);
    expect(w.mode).toEqual({ kind: "seated", on: "bench" });
    // Forward is -z at yaw 0: the pond is on the bench's +z side.
    expect(w.yaw).toBe(Math.PI);
    expect(L.pond.z).toBeGreaterThan(b.z);
    hold(w, "KeyW", 0.3, wd);
    expect(w.mode).toBe(FREE);
    // The bench is solid (#1011): you stand where a walker may stand, in front of it.
    expect(w.z).toBeGreaterThanOrEqual(b.z + BENCH.front + WALKER);
    expect(collide(L, w.x, w.z, WALKER, false, wd.ground.back)).toEqual({ x: w.x, z: w.z });
  });

  test("standing up from the bench with the button puts you a step in front of where you sat, toward the pond", () => {
    const wd = world("shut");
    const b = benchAt(L);
    const w = stand(b.x, b.z - 1, 0);
    sit(w, "bench", wd);
    const seat = { x: w.x, z: w.z };
    toMode(w, FREE, wd);
    expect(w.x).toBe(seat.x);
    expect(w.z).toBeCloseTo(b.z + BENCH.front + WALKER + 0.01, 9);
    expect(collide(L, w.x, w.z, WALKER, false, wd.ground.back)).toEqual({ x: w.x, z: w.z });
  });

  test("with reduced motion the eye is at the seat at once", () => {
    const wd = world("shut", true);
    const w = stand(0, 0, 0);
    sit(w, "bench", wd);
    step(w, NONE, DT, wd);
    expect(w.seat).toBe(1);
  });
});

describe("a tap on the ground walks you there (#336)", () => {
  const bed = L.beds[0];
  // From the path on one side of the first bed to the path on the other: the straight line is through the bed.
  const from = { x: bed.x - bed.w / 2 - 1, z: bed.z };
  const to = { x: bed.x + bed.w / 2 + 1, z: bed.z };

  /** Step a walk to its end. Returns how it ended, checking that every frame stands where a walker may. */
  function walkOut(w: Walker, wd: WalkerWorld) {
    for (let t = 0; t < 30; t += DT) {
      const end = step(w, NONE, DT, wd);
      expect(collide(L, w.x, w.z, WALKER, false, wd.ground.back)).toEqual({ x: w.x, z: w.z });
      if (end) return end;
    }
    throw new Error("the walk did not end in 30 s");
  }

  test("the walk goes round the bed, ends at the spot, and turns the view toward where it goes", () => {
    const wd = world("shut");
    const w = stand(from.x, from.z, 0);
    let arrived = 0;
    startTrip(w, to.x, to.z, 0, () => arrived++, wd);
    expect(w.mode.kind).toBe("trip");
    const end = walkOut(w, wd);
    if (end.end !== "arrived") throw new Error(`the walk ${end.end}`);
    // The scene does what the walk was for.
    end.then?.();
    expect(arrived).toBe(1);
    expect(w.mode).toBe(FREE);
    expect(Math.hypot(w.x - to.x, w.z - to.z)).toBeLessThan(0.01);
    expect(w.yaw).not.toBe(0);
  });

  test("a tap between the bench and the pond, from the garden behind it, walks you round the bench (#1011)", () => {
    const wd = world("shut");
    const b = benchAt(L);
    const to = { x: b.x, z: b.z + BENCH.front + WALKER + 0.05 };
    const w = stand(b.x, b.z - 1, 0);
    startTrip(w, to.x, to.z, 0, null, wd);
    for (let t = 0; t < 30 && w.mode.kind === "trip"; t += DT) {
      step(w, NONE, DT, wd);
      // Never nearer the bench's box than a walker's radius.
      const out = Math.hypot(Math.max(0, Math.abs(w.x - b.x) - BENCH.half), Math.max(0, b.z - BENCH.back - w.z, w.z - b.z - BENCH.front));
      expect(out).toBeGreaterThan(WALKER - 1e-9);
    }
    expect(Math.hypot(w.x - to.x, w.z - to.z)).toBeLessThan(0.01);
  });

  test("a tap on the shut brambles, near the fence, walks you to their front, never through the fence (#1025)", () => {
    const wd = world("shut");
    const w = stand(STILE.foot[0], STILE.foot[1], 0);
    startTrip(w, STILE.x, STILE.z + 0.3, 0, null, wd);
    expect(walkOut(w, wd).end).toBe("arrived");
    expect(w.z).toBeCloseTo(STILE.z + BRAMBLES_IN + WALKER, 6);
  });

  test("with reduced motion the view keeps still", () => {
    const wd = world("shut", true);
    const w = stand(from.x, from.z, 0);
    startTrip(w, to.x, to.z, 0, null, wd);
    expect(walkOut(w, wd).end).toBe("arrived");
    expect(w.yaw).toBe(0);
  });

  test("a walking key takes over from a walk under way", () => {
    const wd = world("shut");
    const w = stand(from.x, from.z, 0);
    startTrip(w, to.x, to.z, 0, null, wd);
    wait(w, 0.2, wd);
    expect(w.mode.kind).toBe("trip");
    hold(w, "KeyW", 0.1, wd);
    expect(w.mode).toBe(FREE);
    const at = { x: w.x, z: w.z };
    wait(w, 1, wd);
    expect({ x: w.x, z: w.z }).toEqual(at);
  });
});
