import { describe, expect, test } from "bun:test";
import { Game, NO_GUESTS, type GameHooks, type WalkVisitors } from "./game";
import { PATH_TURN } from "./lookout";
import { BRAMBLES_IN, STEP } from "./stile";
import type { Input } from "./walker";
import { benchAt, layout, WALKER, type GardenPlant } from "./world";

// The garden played with no browser (#975): the game alone, stepped at a fixed
// 60 frames a second, with no visitors and hooks that only write down what
// they were told.

const DT = 1 / 60;
const DAY = 86_400_000;
const NONE: Input = { move: { x: 0, y: 0 }, run: false };
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

/** A learner whose key lies by a lantern, with a note on the shed and one under the stile's step. */
const VISITORS: WalkVisitors = {
  list: [],
  door: { key: "lantern", help: { visitors: false, glint: false } },
  orchard: { trees: [], firstPlanted: null },
  autumn: false,
  toys: { day: 0 },
  moon: 0,
  met: [],
  firstReview: null,
  notes: [{ id: "n01", unread: true }],
  stile: ["n05"],
  diary: null,
  mouseDoor: null,
};

/** The same learner with note n08: the way over the stile is open (#770). */
const HILL_OPEN: WalkVisitors = { ...VISITORS, notes: [...VISITORS.notes, { id: "n08", unread: false }] };

/** A game as the walk opens, and the hooks it called, in order, each as one short line. */
function play(visitors = VISITORS): { g: Game; told: string[] } {
  const told: string[] = [];
  const hooks: GameHooks = {
    plantTop: () => 0.5,
    select: (p) => told.push(`select ${p?.id ?? "none"}`),
    shake: (p) => told.push(`shake ${p.id}`),
    nod: (p) => told.push(`nod ${p.id}`),
    sneeze: (i) => told.push(`sneeze ${i}`),
    hand: (holding) => told.push(`hand ${holding}`),
    carry: (d) => told.push(`carry ${d.did}`),
    toy: (d) => told.push(`toy ${d.did}`),
    keyTaken: () => told.push("keyTaken"),
    doorOpen: () => told.push("doorOpen"),
    read: (on, id) => told.push(`read ${on} ${id}`),
    open: (id) => told.push(`open ${id}`),
    company: (c) => told.push(`company ${c}`),
    stall: () => told.push("stall"),
    reach: (o) => told.push(`reach ${o?.a ?? "none"}`),
    stars: (out) => told.push(`stars ${out}`),
    time: (t) => told.push(`time ${t}`),
    blend: () => {},
    trip: (to) => told.push(to ? "trip" : "trip end"),
    lantern: (i) => told.push(`lantern ${i}`),
  };
  const g = new Game(L, "es", visitors, true, Date.UTC(2026, 9, 11, 12), hooks, NO_GUESTS);
  g.setTime("day");
  g.placeWaiting();
  g.start();
  return { g, told };
}

/** Step the game with no key held until `done` holds, for at most `s` seconds. Returns whether it came to hold. */
function until(g: Game, done: () => boolean, s = 60): boolean {
  return hold(g, NONE, s, done);
}

const KEY_W: Input = { move: { x: 0, y: 1 }, run: false };

/** Hold `input` for `s` seconds, or until `done` holds. Returns whether it came to hold. */
function hold(g: Game, input: Input, s: number, done: () => boolean = () => false): boolean {
  for (let t = 0; t < s; t += DT) {
    if (done()) return true;
    g.step(DT, input);
  }
  return done();
}

/** Stand at (x, z), facing `yaw` (−z is 0; a positive yaw turns left). */
function stand(g: Game, x: number, z: number, yaw: number) {
  Object.assign(g.me, { x, z, yaw });
}

/** How high the view's ground is where you stand. */
const lift = (g: Game) => g.lift(g.me.x, g.me.z);

describe("the garden plays with no browser", () => {
  test("door, stile, a note, the bench, a pebble to the well: each by a tap or the action button, and the walk gets there", () => {
    const { g, told } = play();
    // A tap on the key walks you to it and picks it up; a tap on the door walks you there and opens it.
    g.tapDoor("key");
    expect(until(g, () => g.door.state === "held")).toBe(true);
    g.tapDoor("open");
    expect(until(g, () => g.door.state === "open")).toBe(true);
    expect(told).toContain("keyTaken");
    expect(told).toContain("doorOpen");

    // A tap on the note under the stile's step walks you to its foot and opens it.
    g.tapNote("n05", 1);
    expect(until(g, () => told.includes("open n05"))).toBe(true);
    expect(told).toContain("read stile n05");

    // Walk to the garden side of the bench: the button says Sit on the bench, and a press sits you down.
    const b = benchAt(L);
    g.walkTo(b.x, b.z - 1.2);
    expect(until(g, () => g.me.mode.kind === "free" && g.offer?.a === "sit")).toBe(true);
    g.act("sit");
    expect(g.me.mode.kind).toBe("seated");
    // Sit a while: time runs on; stand up, and it runs back to now.
    until(g, () => false, 20);
    expect(g.lapse).toBeGreaterThan(0);
    g.act("stand");
    expect(until(g, () => g.lapse === 0)).toBe(true);
    expect(g.shown).toBe("day");

    // A tap on a pebble walks you to it and picks it up; a tap on the well walks you there and drops it in.
    g.tapCarry({ at: "thing", i: 0 });
    expect(until(g, () => g.pebbles.held !== null)).toBe(true);
    g.tapCarry({ at: "well" });
    expect(until(g, () => told.includes("carry well"))).toBe(true);
    expect(until(g, () => told.includes("carry land"))).toBe(true);
    expect(g.pebbles.held).toBeNull();
    // Every walk got where it went.
    expect(told).not.toContain("stall");
  });
});

/** The stile and the hill: VISITORS has notes at the stile, so both are there. */
function hillOf(g: Game) {
  if (!g.stileSpot || !g.hill) throw new Error("no stile");
  return { s: g.stileSpot, h: g.hill };
}

/** The way a walker on the stool faces (to the far house), and the stool's left (toward the post), as [x, z]. */
function facing(g: Game) {
  const { face } = hillOf(g).h;
  const [fx, fz] = [-Math.sin(face), -Math.cos(face)];
  return { ahead: [fx, fz], left: [fz, -fx] };
}

/** Sit on the stool with the button, from just behind it, turned away from the far house. */
function sitOnStool(g: Game) {
  const { h } = hillOf(g);
  const { ahead } = facing(g);
  stand(g, h.stool[0] - ahead[0] * 0.6, h.stool[1] - ahead[1] * 0.6, h.face + 1);
  g.step(DT, NONE);
  expect(g.offer?.a).toBe("stool");
  g.act("stool");
}

/** On the lantern post's far side from the stool, facing the post. */
function byPost(g: Game) {
  const { h } = hillOf(g);
  const { left } = facing(g);
  stand(g, h.post[0] + left[0] * 0.6, h.post[1] + left[1] * 0.6, Math.atan2(left[0], left[1]));
  g.step(DT, NONE);
}

/** Blow the lantern out and light it again with the button: one signal. */
function signal(g: Game) {
  expect(g.offer?.a).toBe("snuff");
  g.act("snuff");
  g.step(DT, NONE);
  expect(g.offer?.a).toBe("light");
  g.act("light");
  g.step(DT, NONE);
}

/** Step `s` seconds with no key held: how many times the far light went out, whether it shows at the end, and the line under the garden, if one showed. */
function watchFarLight(g: Game, s: number): { dark: number; on: boolean; line: string | null } {
  let [dark, was] = [0, g.lookout.on(g.elapsed)];
  let line: string | null = null;
  until(
    g,
    () => {
      const on = g.lookout.on(g.elapsed);
      if (was && !on) dark++;
      was = on;
      if (g.line) line = g.line.text;
      return false;
    },
    s,
  );
  return { dark, on: was, line };
}

// docs/garden-play.md, "Back fence, stile and hill": where you go, what the view
// does, and what the stool and the lantern do. The walker's own walls
// (fence.solid, stile.sides-solid, hill.brambles) are in walker.test.ts.
describe("over the stile and up the hill", () => {
  test("stile.shut: before n08, walking with W at the stile stops you at the brambles in front of it, and no button names a way over", () => {
    const { g } = play();
    const { s } = hillOf(g);
    stand(g, s.x, s.foot[1] + 1, 0);
    const offers = new Set<string>();
    hold(g, KEY_W, 1.5, () => (offers.add(g.offer ? `${g.offer.on} ${g.offer.a}` : "none"), false));
    expect(g.me.z).toBeCloseTo(s.z + BRAMBLES_IN + WALKER, 6);
    expect(lift(g)).toBe(0);
    // Only the notes under the step are in reach: nothing to climb.
    expect([...offers].filter((o) => o !== "none" && o !== "note read")).toEqual([]);
  });

  test("stile.walk-over: with n08, holding W at the front of the stile takes you up its steps, over the top board and down onto the path past the fence; the view rises on the way", () => {
    const { g } = play(HILL_OPEN);
    const { s } = hillOf(g);
    stand(g, s.x, s.foot[1], 0);
    let high = 0;
    const past = () => {
      high = Math.max(high, lift(g));
      return g.me.z < s.z - STEP.out - 0.3;
    };
    expect(hold(g, KEY_W, 20, past)).toBe(true);
    expect(high).toBeGreaterThan(0.7);
    expect(lift(g)).toBeLessThan(0.5);
  });

  test("stile.stop-on-steps: with n08, letting go of W on the top board leaves you there: two seconds later your place and height have not changed", () => {
    const { g } = play(HILL_OPEN);
    const { s } = hillOf(g);
    stand(g, s.x, s.foot[1], 0);
    expect(hold(g, KEY_W, 20, () => g.me.z < s.z + 0.15)).toBe(true);
    expect(Math.abs(g.me.z - s.z)).toBeLessThan(STEP.out);
    const top = { x: g.me.x, z: g.me.z, y: lift(g) };
    expect(top.y).toBeGreaterThan(0.4);
    until(g, () => false, 2);
    expect({ x: g.me.x, z: g.me.z, y: lift(g) }).toEqual(top);
  });

  test("stile.slide-on: with n08, walking with W into the front of the steps a little to one side puts you on them", () => {
    const { g } = play(HILL_OPEN);
    const { s } = hillOf(g);
    stand(g, s.x + STEP.w / 2 - 0.1, s.foot[1], 0);
    expect(hold(g, KEY_W, 20, () => g.me.z < s.z - STEP.out)).toBe(true);
    expect(Math.abs(g.me.x - s.x)).toBeLessThan(STEP.w / 2);
  });

  test("hill.walk-up: with n08, holding W along the old path takes you up to the hilltop, and your view rises with the ground", () => {
    const { g } = play(HILL_OPEN);
    const { s, h } = hillOf(g);
    stand(g, s.x, s.foot[1], PATH_TURN);
    expect(hold(g, KEY_W, 20, () => Math.hypot(g.me.x - h.top[0], g.me.z - h.top[1]) < 1.5)).toBe(true);
    expect(lift(g)).toBeGreaterThan(2);
  });

  test("hill.walk-back: from the hilltop, walking back down the path takes you over the stile into the garden; two seconds after you stop, your place has not changed", () => {
    const { g } = play(HILL_OPEN);
    const { s, h } = hillOf(g);
    stand(g, h.top[0], h.top[1], PATH_TURN + Math.PI);
    expect(hold(g, KEY_W, 20, () => g.me.z > s.z + 1)).toBe(true);
    expect(lift(g)).toBeLessThan(0.05);
    const here = { x: g.me.x, z: g.me.z };
    until(g, () => false, 2);
    expect({ x: g.me.x, z: g.me.z }).toEqual(here);
  });

  test("hill.sit: by the stool the button says Sit on the stool; pressing it seats you facing the far house; W stands you up", () => {
    const { g } = play(HILL_OPEN);
    const { h } = hillOf(g);
    sitOnStool(g);
    expect(g.me.mode).toEqual({ kind: "seated", on: "stool" });
    expect([g.me.x, g.me.z]).toEqual(h.stool);
    expect(g.me.yaw).toBe(h.face);
    g.step(DT, NONE);
    expect(g.offer?.a).toBe("stand");
    hold(g, KEY_W, 0.3);
    expect(g.me.mode.kind).toBe("free");
  });

  test("hill.sit-night: by day, sitting still on the stool, within 60 seconds it is dusk and the button is Blow out the lantern; then night, still night 30 seconds later; standing up, time runs back to day", () => {
    const { g } = play(HILL_OPEN);
    sitOnStool(g);
    expect(until(g, () => g.offer?.a === "snuff", 60)).toBe(true);
    expect(g.shown).toBe("dusk");
    expect(until(g, () => g.shown === "night", 60)).toBe(true);
    until(g, () => false, 30);
    expect(g.shown).toBe("night");
    expect(g.me.mode.kind).toBe("seated");
    hold(g, KEY_W, 0.3);
    expect(until(g, () => g.lapse === 0, 60)).toBe(true);
    expect(g.shown).toBe("day");
  });

  test("hill.lantern: at night, by the lantern's post on the hilltop, the button says Blow out the lantern; pressing it puts the flame out, and the button says Light the lantern", () => {
    const { g } = play(HILL_OPEN);
    g.setTime("night");
    byPost(g);
    expect(g.offer?.a).toBe("snuff");
    g.act("snuff");
    expect(g.lamps.on[g.lamps.lookout]).toBe(false);
    g.step(DT, NONE);
    expect(g.offer?.a).toBe("light");
  });

  test("hill.no-answer: at night, before n12, blowing out the lantern and lighting it again twice leaves the far light shining", () => {
    const { g } = play(HILL_OPEN);
    g.setTime("night");
    byPost(g);
    signal(g);
    signal(g);
    // Longer than an answer would take.
    expect(watchFarLight(g, 8)).toEqual({ dark: 0, on: true, line: null });
  });

  test("hill.answer: with n12, by day, sat on the stool till night, two signals from the seat make the far light go dark twice and the line says the answer; two more get another", () => {
    const { g } = play({ ...HILL_OPEN, notes: [...HILL_OPEN.notes, { id: "n12", unread: false }] });
    sitOnStool(g);
    expect(until(g, () => g.shown === "night", 120)).toBe(true);
    for (let round = 0; round < 2; round++) {
      signal(g);
      expect(watchFarLight(g, 0.5)).toEqual({ dark: 0, on: true, line: null });
      signal(g);
      // Long enough for the line to go again before the next round.
      expect(watchFarLight(g, 20)).toEqual({ dark: 2, on: true, line: "El lucero contesta." });
    }
  });
});
