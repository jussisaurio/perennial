import { describe, expect, test } from "bun:test";
import { ORCHARD_WORDS } from "../deck/schema";
import { DAY_MS } from "../core/day";
import { hidesToday, hideout, PLACES, SEEK_REACH, type Hiding } from "./hide";
import { collideTrees, placeTrees, type OrchardTree, type PlacedTree } from "./orchard";
import type { Spots } from "./spots";
import { leafPiles } from "./walkInto";
import { BED_H, benchAt, collide, lanternSpots, layout, WALKER, type GardenPlant, type Layout } from "./world";
import { KINDS } from "./kinds";
import type { Frame } from "./scenePart";
import { conditions } from "./conditions";

// Hide-and-seek (#379): pinned days, gardens of every size.

const plant = (i: number): GardenPlant => ({ id: `w${i}`, lemma: `word${i}`, gloss: "", pos: ["noun", "verb", "adj"][i % 3], rank: i, s: 10, r: 0.95, stage: "bloom", growth: 0.5, listen: false, write: false, forms: [] });
const gardens = [0, 1, 3, 40, 300, 800].map((n) => layout(Array.from({ length: n }, (_, i) => plant(i))));
const TREES: OrchardTree[] = ORCHARD_WORDS.map((kind, i) => ({ id: `t${i}`, lemma: `tree${i}`, gloss: kind, kind, planted: 0, height: 3, look: "leaves" }));

/** The spots the scene fills (scene.ts spots): the pond's four pads as sceneSky.ts places them, the first bed's sign, autumn's piles, and the orchard when the door is open. */
function spotsFor(l: Layout, opts: { autumn: boolean; door: boolean }): { spots: Spots; trees: PlacedTree[] } {
  const first = l.beds[0];
  const sign: [number, number, number] = [first.x - first.w / 2 - 0.3, 0.93, first.z + first.d / 2 + 0.3];
  const pads = Array.from({ length: 4 }, (_, i): [number, number] => [l.pond.x + Math.cos(i * 1.9 + 0.4) * l.pond.r * 0.55, l.pond.z + Math.sin(i * 1.9 + 0.4) * l.pond.r * 0.55]);
  const trees = opts.door ? placeTrees(l.orchard, TREES) : [];
  const spots: Spots = { bench: benchAt(l), pads, lanterns: lanternSpots(l), perches: [sign], sign, trees: [], orchard: trees, piles: opts.autumn ? leafPiles(l) : [] };
  return { spots, trees };
}

const day = (from: Date, n: number) => new Date(from.getTime() + n * DAY_MS);
const AUTUMN = new Date(2026, 9, 1, 12);
const SPRING = new Date(2026, 3, 1, 12);

/** The place a hideout is in, from what its tag says. */
function placeOf(h: Hiding): string {
  if (h.where.text === "behind" && h.where.word?.startsWith("tree")) return "orchard";
  if (h.where.text === "behind") return "plant";
  return h.where.text;
}

/** Is there ground a walker can stand on (inside the fence, out of beds, the pond and trunks) within the action button's reach of this spot? */
function reachable(l: Layout, h: Hiding, door: boolean, trees: readonly PlacedTree[]): boolean {
  for (let r = 0.25; r < SEEK_REACH - 0.05; r += 0.1)
    for (let a = 0; a < 48; a++) {
      const x = h.x + Math.cos((a / 48) * Math.PI * 2) * r;
      const z = h.z + Math.sin((a / 48) * Math.PI * 2) * r;
      const c = collide(l, x, z, WALKER, door);
      const at = collideTrees(trees, c.x, c.z, WALKER);
      if (Math.hypot(at.x - x, at.z - z) < 1e-9) return true;
    }
  return false;
}

describe("the gnome's hide-and-seek", () => {
  test("it hides on about half the days in a new garden, and more often as the garden gets older", () => {
    const share = (age: number) => Array.from({ length: 2000 }, (_, i) => hidesToday(age, day(SPRING, i))).filter(Boolean).length / 2000;
    expect(share(0)).toBeGreaterThan(0.4);
    expect(share(0)).toBeLessThan(0.5);
    expect(share(300)).toBeGreaterThan(0.65);
    expect(share(300)).toBeLessThan(0.75);
    // The same all day.
    expect(hidesToday(40, new Date(2026, 9, 5, 0, 5))).toBe(hidesToday(40, new Date(2026, 9, 5, 23, 55)));
  });

  test("a young garden has only the easy places; an old one, in autumn with the door open, has every place", () => {
    const l = gardens[3];
    const seen = (age: number, from: Date, door: boolean) => {
      const { spots } = spotsFor(l, { autumn: true, door });
      const places = new Set<string>();
      for (let i = 0; i < 600; i++) {
        const h = hideout(l, spots, age, day(from, i % 60));
        if (h) places.add(placeOf(h));
      }
      return places;
    };
    // Days in autumn only, so the piles are there.
    expect(seen(0, AUTUMN, true)).toEqual(new Set(["plant", "under the bench", "on the sign"]));
    expect(seen(400, AUTUMN, true)).toEqual(new Set(["plant", "under the bench", "on the sign", "among the lily pads", "behind the leaves", "orchard"]));
    // Door shut: never the orchard.
    expect(seen(400, AUTUMN, false).has("orchard")).toBe(false);
    expect(Math.max(...Object.values(PLACES))).toBeLessThan(400);
  });

  test("in a young garden it hides only in the front row of a bed, behind the plant (away from the gate), and its tag names the plant's word", () => {
    for (const l of gardens.slice(1)) {
      const { spots } = spotsFor(l, { autumn: false, door: false });
      for (let i = 0; i < 400; i++) {
        const h = hideout(l, spots, 3, day(SPRING, i));
        if (!h || h.where.text !== "behind") continue;
        const p = l.plants.find((q) => q.lemma === h.where.word)!;
        const bed = l.beds[p.bed];
        expect(bed.z + bed.d / 2 - p.z).toBeLessThan(0.8);
        expect(h.z).toBeLessThan(p.z);
        expect(h.x).toBe(p.x);
        expect(h.y).toBe(BED_H);
        expect(h.look).toBe("peek");
      }
    }
  });

  test("every spot, in gardens of 0 to 800 plants, is in the garden (or the open orchard) and in reach from ground you can stand on", () => {
    let checked = 0;
    for (const l of gardens)
      for (const door of [false, true])
        for (const from of [AUTUMN, SPRING]) {
          const { spots, trees } = spotsFor(l, { autumn: from === AUTUMN, door });
          for (const age of [0, 8, 30, 400])
            for (let i = 0; i < 40; i++) {
              const h = hideout(l, spots, age, day(from, i));
              if (!h) continue;
              checked++;
              const b = l.bounds;
              const o = l.orchard;
              const inGarden = h.x > b.minX && h.x < b.maxX && h.z > b.minZ && h.z < b.maxZ;
              const inOrchard = door && Math.abs(h.x - o.x) < o.w / 2 && Math.abs(h.z - o.z) < o.d / 2;
              expect(inGarden || inOrchard).toBe(true);
              expect(reachable(l, h, door, trees)).toBe(true);
            }
        }
    expect(checked).toBeGreaterThan(500);
  });
});

describe("the gnome, hiding and found", () => {
  const l = gardens[3];
  const { spots } = spotsFor(l, { autumn: false, door: false });
  const days = Array.from({ length: 60 }, (_, i) => day(SPRING, i));
  const hiding = days.find((d) => hideout(l, spots, 30, d))!;
  const home = days.find((d) => !hideout(l, spots, 30, d))!;
  const arrive = (now: Date, reducedMotion = false) => KINDS.gnome.arrive({ spots, layout: l, home: null, now, age: 30, reducedMotion })!;
  const frame = (elapsed: number): Frame => ({ dt: 1 / 60, elapsed, x: 0, z: 0, yaw: 0, speed: 0 });

  test("on a day it does not hide, it stands at a bed corner as it always has, its name showing", () => {
    const g = arrive(home);
    expect(g.body.hiding).toBe(false);
    expect(g.body.hid).toBeNull();
    expect(g.body.frame).toBe("front");
    expect(l.beds.some((b) => Math.abs(Math.abs(g.body.at.x - b.x) - (b.w / 2 + 0.2)) < 1e-9 && Math.abs(Math.abs(g.body.at.z - b.z) - (b.d / 2 + 0.2)) < 1e-9)).toBe(true);
  });

  test("hiding, its name never shows and it does not turn; found, it pops up, falls flat, and its tag says where it was", () => {
    const g = arrive(hiding);
    const h = hideout(l, spots, 30, hiding)!;
    expect(g.body.at).toEqual({ x: h.x, y: h.y, z: h.z });
    expect([g.body.hiding, g.body.tag, g.body.frame, g.body.hid]).toEqual([true, 0, h.look, h.where]);
    // Its lantern would give it away at night.
    g.onConditions!(conditions("night"));
    g.step!(frame(10), false);
    expect([g.body.frame, g.body.glow, g.body.tag]).toEqual([h.look, false, 0]);

    g.onFind!(20);
    expect([g.body.hiding, g.body.tag, g.body.hid]).toEqual([false, 1, h.where]);
    g.step!(frame(20.1), true);
    expect(g.body.frame).toBe("front");
    expect(g.body.y).toBeGreaterThan(h.y);
    g.step!(frame(20.4), true);
    expect(g.body.frame).toBe("fallen");
    g.step!(frame(25), false);
    // Flat on the ground, unlit, and it stays down: no statues while it lies there.
    expect([g.body.frame, g.body.y, g.body.glow, g.body.tag]).toEqual(["fallen", h.y, false, 1]);
  });

  test("a call (#377) does not give it away while it hides, nor stir it once it lies flat; on other days it still freezes", () => {
    const call = { elapsed: 1, x: 0, z: 0, lang: "es" };
    const g = arrive(hiding);
    expect(g.onCall!(call)).toBeNull();
    g.onFind!(2);
    expect(g.onCall!({ ...call, elapsed: 3 })).toBeNull();
    expect(arrive(home).onCall!(call)).not.toBeNull();
  });

  test("with reduced motion it is flat at once", () => {
    const g = arrive(hiding, true);
    g.onFind!(3);
    g.step!(frame(3.01), true);
    expect([g.body.frame, g.body.y]).toEqual(["fallen", g.body.at.y]);
  });

  test("called to the bench while it hides (#362), it gives up hiding: it stands, and has nothing to say about where it was", () => {
    const g = arrive(hiding);
    g.onVisit!(true);
    expect([g.body.hiding, g.body.hid, g.body.frame, g.body.tag]).toEqual([false, null, "front", 1]);
  });
});
