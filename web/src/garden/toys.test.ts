import { describe, expect, test } from "bun:test";
import { dayNumber } from "../core/day";
import { boatAt, blowEnds, dandelions, flight, HEAD_TOP, SEEDS, seedAt, voyage, windFor } from "./toys";
import { collide, layout, type GardenPlant } from "./world";

/** 17 Oct 2026, local: a pinned day. */
const DAY = dayNumber(new Date(2026, 9, 17, 12, 0));
const BED_TOP = 0.28;
const plant = (i: number): GardenPlant => ({ id: `w${i}`, lemma: `word${i}`, gloss: "", pos: ["noun", "verb", "adj"][i % 3], rank: i, s: 10, r: 0.95, stage: "bloom", growth: 0.5, listen: false, write: false });
const small = layout(Array.from({ length: 3 }, (_, i) => plant(i)));
const big = layout(Array.from({ length: 400 }, (_, i) => plant(i)));
const out = { x: 0, y: 0, z: 0, a: 0 };

describe("the wind", () => {
  test("is the same all day, and changes from day to day", () => {
    expect(windFor(DAY)).toEqual(windFor(DAY));
    const ways = new Set(Array.from({ length: 10 }, (_, i) => Math.round(Math.atan2(windFor(DAY + i).z, windFor(DAY + i).x) * 10)));
    expect(ways.size).toBeGreaterThan(5);
  });

  test("is a breeze, never still and never a gale", () => {
    for (let d = 0; d < 100; d++) {
      const w = windFor(DAY + d);
      expect(Math.hypot(w.x, w.z)).toBeGreaterThan(0.3);
      expect(Math.hypot(w.x, w.z)).toBeLessThan(1);
    }
  });
});

describe("dandelion clocks", () => {
  test("three by the fence, on open ground a walker can reach, in a small and a big garden", () => {
    for (const l of [small, big]) {
      const base = dandelions(l, DAY, BED_TOP).filter((h) => h.id.startsWith("base"));
      expect(base).toHaveLength(3);
      for (const h of base) {
        const free = collide(l, h.x, h.z, 0.3);
        expect(Math.hypot(free.x - h.x, free.z - h.z)).toBeLessThan(1e-9);
      }
    }
  });

  test("a new clock grows where a seed from an earlier day's wind came down", () => {
    const heads = dandelions(big, DAY, BED_TOP);
    const grew = heads.filter((h) => h.id.startsWith("grew"));
    expect(grew.length).toBeGreaterThan(0);
    for (const g of grew) {
      const day = Number(g.id.split(":")[1]);
      expect(day).toBeLessThan(DAY);
      expect(day).toBeGreaterThanOrEqual(DAY - 3);
      // One of that day's clocks sent a seed exactly there, with that day's wind.
      const from = dandelions(big, day, BED_TOP).filter((h) => h.id.startsWith("base"));
      const landed = from.some((h) => Array.from({ length: SEEDS }, (_, i) => flight(big, h, day, i, BED_TOP)).some((f) => f.ground && f.to.x === g.x && f.to.z === g.z));
      expect(landed).toBe(true);
    }
  });

  test("most days a new clock grows, and it stays for three days", () => {
    const grewOn = Array.from({ length: 100 }, (_, i) => DAY + i).filter((d) => dandelions(big, d + 1, BED_TOP).some((h) => h.id === `grew:${d}`));
    expect(grewOn.length).toBeGreaterThan(70);
    const d = grewOn[0];
    const first = dandelions(big, d + 1, BED_TOP).find((h) => h.id === `grew:${d}`);
    expect(dandelions(big, d + 3, BED_TOP).find((h) => h.id === `grew:${d}`)).toEqual(first!);
    expect(dandelions(big, d + 4, BED_TOP).find((h) => h.id === `grew:${d}`)).toBeUndefined();
  });

  test("clocks never grow on top of each other", () => {
    for (let d = 0; d < 30; d++) {
      const heads = dandelions(big, DAY + d, BED_TOP);
      for (const a of heads) for (const b of heads) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(0.9);
    }
  });
});

describe("a blow", () => {
  const head = dandelions(big, DAY, BED_TOP)[0];
  const flights = Array.from({ length: SEEDS }, (_, i) => flight(big, head, DAY, i, BED_TOP));

  test("the seeds go downwind", () => {
    const w = windFor(DAY);
    for (const f of flights) expect((f.to.x - f.from.x) * w.x + (f.to.z - f.from.z) * w.z).toBeGreaterThan(0);
  });

  test("a seed starts on its clock, rises, and comes down where it lands", () => {
    const f = flights[0];
    seedAt(f, 0, false, out);
    expect([out.x, out.y, out.z]).toEqual([f.from.x, HEAD_TOP, f.from.z]);
    seedAt(f, f.delay + f.time / 2, false, out);
    expect(out.y).toBeGreaterThan(HEAD_TOP);
    seedAt(f, f.delay + f.time, false, out);
    expect(out.x).toBeCloseTo(f.to.x, 9);
    expect(out.z).toBeCloseTo(f.to.z, 9);
    expect(out.y).toBeCloseTo(f.land, 9);
    expect(out.a).toBe(1);
  });

  test("a landed seed fades, and everything is gone when the blow ends", () => {
    const end = blowEnds(flights, false);
    for (const f of flights) {
      seedAt(f, end, false, out);
      expect(out.a).toBe(0);
    }
  });

  test("with reduced motion the seeds stay on the clock and fade", () => {
    const f = flights[3];
    seedAt(f, f.delay + 0.75, true, out);
    expect([out.x, out.z]).toEqual([f.from.x, f.from.z]);
    expect(out.a).toBeCloseTo(0.5, 9);
    seedAt(f, blowEnds(flights, true), true, out);
    expect(out.a).toBe(0);
  });

  test("a seed that comes down on a plant lands on that plant, at its bed's height", () => {
    // A breeze across the beds: some seed of some clock, some day, lands on a plant.
    let hit = null;
    for (let d = 0; d < 60 && !hit; d++)
      for (const h of dandelions(big, DAY + d, BED_TOP))
        for (let i = 0; i < SEEDS && !hit; i++) {
          const f = flight(big, h, DAY + d, i, BED_TOP);
          if (f.plant >= 0) hit = f;
        }
    expect(hit).not.toBeNull();
    const p = big.plants[hit!.plant];
    expect(Math.hypot(p.x - hit!.to.x, p.z - hit!.to.z)).toBeLessThan(0.3);
    expect(hit!.land).toBe(BED_TOP);
    expect(hit!.ground).toBe(false);
  });
});

describe("a paper boat", () => {
  const pond = big.pond;
  const p = { x: 0, z: 0 };
  const fromPond = () => Math.hypot(p.x - pond.x, p.z - pond.z);

  test("sets off from the rim nearest the folder, and floats out", () => {
    const v = voyage(pond, pond.x, pond.z - pond.r - 0.4, DAY);
    boatAt(v, 0, p);
    expect(p.x).toBeCloseTo(pond.x, 9);
    expect(p.z).toBeLessThan(pond.z);
    const start = fromPond();
    boatAt(v, 2, p);
    expect(fromPond()).toBeLessThan(start);
  });

  test("always stays on the water, and comes to rest downwind against the rim", () => {
    for (let d = 0; d < 20; d++) {
      const v = voyage(pond, pond.x + pond.r + 0.4, pond.z, DAY + d);
      for (let t = 0; t < 600; t += 7) {
        boatAt(v, t, p);
        expect(fromPond()).toBeLessThanOrEqual(pond.r - 0.25 + 1e-9);
      }
      boatAt(v, 3600, p);
      const w = windFor(DAY + d);
      const along = ((p.x - pond.x) * w.x + (p.z - pond.z) * w.z) / Math.hypot(w.x, w.z) / fromPond();
      expect(along).toBeGreaterThan(0.99);
    }
  });
});
