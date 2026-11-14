import { describe, expect, test } from "bun:test";
import { Game, NO_GUESTS, type GameHooks, type WalkVisitors } from "./game";
import type { Input } from "./walker";
import { benchAt, layout, type GardenPlant } from "./world";

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

/** A game as the walk opens, and the hooks it called, in order, each as one short line. */
function play(): { g: Game; told: string[] } {
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
  const g = new Game(L, "es", VISITORS, true, Date.UTC(2026, 9, 11, 12), hooks, NO_GUESTS);
  g.setTime("day");
  g.placeWaiting();
  g.start();
  return { g, told };
}

/** Step the game with no key held until `done` holds, for at most `s` seconds. Returns whether it came to hold. */
function until(g: Game, done: () => boolean, s = 60): boolean {
  for (let t = 0; t < s; t += DT) {
    if (done()) return true;
    g.step(DT, NONE);
  }
  return done();
}

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
