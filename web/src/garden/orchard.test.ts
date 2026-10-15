import { describe, expect, test } from "bun:test";
import { DAY_MS } from "../core/day";
import { deriveMemory, type MemoryRow } from "../core/memory";
import type { ReviewRow } from "../data/rows";
import { ORCHARD_WORDS, type GardenWord, type OrchardWord } from "../deck/schema";
import {
  benchLine,
  collideTrees,
  FRUIT_S,
  ORCHARD_MIN,
  orchardBench,
  orchardInput,
  orchardTrees,
  pickTree,
  placeTrees,
  treeHits,
  treeVisitorSpots,
  type OrchardInput,
  type OrchardLearner,
  type OrchardTree,
} from "./orchard";

const NOW = Date.UTC(2026, 9, 15, 12);
const days = (n: number) => NOW - n * DAY_MS;
const input = (kind: OrchardWord, plantedDaysAgo: number, read: OrchardInput["read"]): OrchardInput => ({ id: `id-${kind}`, lemma: kind, gloss: kind, kind, planted: days(plantedDaysAgo), read });
const LEARNING = { s: 2, reps: 1, lapses: 0 };
const one = (i: OrchardInput, now = NOW): OrchardTree => orchardTrees([i], now)[0];

/** Read reviews of one word at these days ago, with these grades, replayed by FSRS as the app does. */
function readMemory(grades: [number, 1 | 2 | 3 | 4][], upTo: number): MemoryRow {
  const reviews = grades
    .filter(([ago]) => days(ago) <= upTo)
    .map(([ago, grade], i): ReviewRow => ({ id: `r${i}`, user_id: "u", lang: "es", word_id: "w", skill: "read", grade, kind: "review", reviewed_at: new Date(days(ago)).toISOString(), duration_ms: 1000, sentence_id: null }));
  return deriveMemory(reviews, 0.9, (id) => id).find((m) => m.skill === "read")!;
}

describe("a tree grows with time", () => {
  test("fast at first, then slower, and a months-old tree is clearly bigger", () => {
    const h = (ago: number) => one(input("apple", ago, LEARNING)).height;
    const heights = [0, 1, 7, 30, 60, 90, 180].map(h);
    for (let i = 1; i < heights.length; i++) expect(heights[i]).toBeGreaterThan(heights[i - 1]);
    expect(h(30) - h(0)).toBeGreaterThan(h(90) - h(60));
    expect(h(180)).toBeGreaterThan(2.5 * h(0));
  });

  test("it stops growing at full size", () => {
    expect(one(input("apple", 400, LEARNING)).height).toBe(one(input("apple", 2000, LEARNING)).height);
  });

  test("a little bigger for each time the word was remembered", () => {
    const few = one(input("pear", 10, { s: 4, reps: 2, lapses: 0 })).height;
    const many = one(input("pear", 10, { s: 4, reps: 6, lapses: 0 })).height;
    expect(many).toBeGreaterThan(few);
    expect(many - few).toBeLessThan(0.5);
  });

  test("a first review in the future (another device's clock) is a new tree, not a broken one", () => {
    expect(one(input("fig", -0.5, LEARNING)).height).toBe(one(input("fig", 0, LEARNING)).height);
  });
});

describe("a tree's look comes from memory", () => {
  test("leaves while learning, blossom once known, fruit once well known", () => {
    expect(one(input("cherry", 5, { s: 2, reps: 1, lapses: 0 })).look).toBe("leaves");
    // Stable after one lucky review is still learning.
    expect(one(input("cherry", 5, { s: 30, reps: 1, lapses: 0 })).look).toBe("leaves");
    expect(one(input("cherry", 20, { s: 10, reps: 3, lapses: 0 })).look).toBe("blossom");
    expect(one(input("cherry", 60, { s: FRUIT_S, reps: 4, lapses: 0 })).look).toBe("fruit");
  });

  test("forgetting takes the fruit until the word is remembered again, and the tree never shrinks", () => {
    // Good answers a month apart, then a forgotten one, then good answers again.
    const log: [number, 1 | 2 | 3 | 4][] = [[200, 3], [199, 3], [196, 3], [188, 3], [170, 3], [130, 3], [60, 1], [59, 3], [55, 3], [45, 3], [20, 3]];
    const at = (ago: number) => {
      const now = days(ago);
      return one({ id: "w", lemma: "manzana", gloss: "apple", kind: "apple", planted: days(200), read: readMemory(log, now) }, now);
    };
    const before = at(61);
    const forgotten = at(59.5);
    const again = at(0);
    expect(before.look).toBe("fruit");
    expect(forgotten.look).toBe("leaves");
    expect(again.look).toBe("fruit");
    // Day by day through the whole story, the tree only grows.
    let last = 0;
    for (let ago = 200; ago >= 0; ago -= 0.5) {
      const h = at(ago).height;
      expect(h).toBeGreaterThanOrEqual(last);
      last = h;
    }
  });
});

describe("the learner's orchard words", () => {
  test("every started orchard word, planted at its first reading review; other and ignored words are left out", () => {
    const row = (id: string, skill: MemoryRow["skill"], reps: number): MemoryRow => ({ key: `${id}:${skill}`, wordId: id, skill, s: 3, d: 5, lastTs: NOW, due: NOW, reps, lapses: 0 });
    const review = (id: string, skill: MemoryRow["skill"], ago: number) => ({ word_id: id, skill, reviewed_at: new Date(days(ago)).toISOString() }) as ReviewRow;
    const l: OrchardLearner = {
      words: new Map([
        ["a", { id: "a", lemma: "manzana", gloss: "apple", status: "active", orchard: "apple" as const }],
        ["b", { id: "b", lemma: "limón", gloss: "lemon", status: "ignored", orchard: "lemon" as const }],
        ["c", { id: "c", lemma: "casa", gloss: "house", status: "active" }],
      ]),
      memories: [row("a", "read", 2), row("a", "listen", 0), row("b", "read", 2), row("c", "read", 2)],
      reviewsByWord: new Map([
        ["a", [review("a", "read", 3), review("a", "listen", 9), review("a", "read", 5)]],
        ["b", [review("b", "read", 1)]],
        ["c", [review("c", "read", 1)]],
      ]),
    };
    const got = orchardInput(l);
    expect(got.map((i) => [i.id, i.kind, i.planted])).toEqual([["a", "apple", days(5)]]);
  });
});

describe("where the trees stand", () => {
  const area = { x: 4, z: -30, ...ORCHARD_MIN };
  // Every kind, as big as it ever grows.
  const all = orchardTrees(
    ORCHARD_WORDS.map((k) => input(k, 3000, { s: 300, reps: 40, lapses: 0 })),
    NOW,
  );

  test("the same spots every time, whatever order the words come in", () => {
    expect(placeTrees(area, all)).toEqual(placeTrees(area, [...all].reverse()).sort((a, b) => ORCHARD_WORDS.indexOf(a.kind) - ORCHARD_WORDS.indexOf(b.kind)));
  });

  test("a tree keeps its spot when others are planted", () => {
    const alone = placeTrees(area, [all[3]])[0];
    const among = placeTrees(area, all).find((t) => t.kind === all[3].kind)!;
    expect([among.x, among.z]).toEqual([alone.x, alone.z]);
  });

  test("full-grown, no two crowns overlap and every tree stays inside the hedge, clear of the bench", () => {
    const placed = placeTrees(area, all);
    expect(placed).toHaveLength(ORCHARD_WORDS.length);
    for (const a of placed) {
      expect(a.x - a.half).toBeGreaterThan(area.x - area.w / 2);
      expect(a.x + a.half).toBeLessThan(area.x + area.w / 2);
      expect(a.z - a.half).toBeGreaterThan(area.z - area.d / 2);
      expect(a.z + a.half).toBeLessThan(area.z + area.d / 2);
      for (const b of placed) if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(a.half + b.half);
    }
    const bench = orchardBench(area);
    for (const t of placed) expect(Math.abs(t.z - bench.z) > t.half + 0.3 || Math.abs(t.x - bench.x) > t.half + 0.7).toBe(true);
  });

  test("the path up the middle from the door stays open", () => {
    for (const t of placeTrees(area, all)) expect(Math.abs(t.x - area.x) - t.half).toBeGreaterThan(0.6);
  });

  test("an area too small for every kind fails loudly", () => {
    expect(() => placeTrees({ ...area, w: ORCHARD_MIN.w - 1 }, all)).toThrow();
  });

  test("a walker cannot pass through a trunk", () => {
    const [t] = placeTrees(area, all);
    const out = collideTrees([t], t.x + 0.05, t.z);
    expect(Math.hypot(out.x - t.x, out.z - t.z)).toBeGreaterThanOrEqual(0.5);
    expect(collideTrees([t], t.x + 3, t.z)).toEqual({ x: t.x + 3, z: t.z });
  });
});

describe("tapping a tree", () => {
  const area = { x: 0, z: -20, ...ORCHARD_MIN };
  const placed = placeTrees(area, orchardTrees(ORCHARD_WORDS.map((k) => input(k, 90, LEARNING)), NOW));
  const hits = treeHits(placed);
  const eye = (x: number, z: number, tx: number, ty: number, tz: number) => {
    const d = Math.hypot(tx - x, ty - 1.05, tz - z);
    return { ox: x, oy: 1.05, oz: z, dx: (tx - x) / d, dy: (ty - 1.05) / d, dz: (tz - z) / d };
  };

  test("looking at a tree's crown names that tree, and its tag sits over the crown", () => {
    for (const t of placed) {
      // From the gap between rows, in front of the tree.
      const got = pickTree(eye(t.x, t.z + 1.6, t.x, t.height * 0.7, t.z), hits);
      expect(got?.hit.id).toBe(t.id);
      expect(got!.hit.tag[1]).toBeGreaterThan(t.height);
    }
  });

  test("the nearer of two trees in a line wins", () => {
    const [a, b] = [...placed].sort((p, q) => q.z - p.z).filter((t, _, l) => Math.abs(t.x - l[0].x) < 0.5);
    const got = pickTree(eye(a.x, a.z + 3, b.x, 1, b.z), hits);
    expect(got?.hit.id).toBe(a.id);
  });

  test("looking at the sky over the trees names nothing", () => {
    expect(pickTree(eye(0, area.z + area.d / 2, 0, 50, area.z), hits)).toBeNull();
  });
});

describe("the bench and the visitors", () => {
  test("the bench shows the day the first word was planted", () => {
    expect(benchLine(new Date(2026, 9, 3, 18).getTime())).toBe("First word planted 3 Oct 2026");
  });

  const area = { x: 0, z: -20, ...ORCHARD_MIN };
  const trees = placeTrees(area, orchardTrees([input("apple", 50, { s: 30, reps: 5, lapses: 0 }), input("olive", 10, LEARNING), input("tree", 80, LEARNING)], NOW));
  const brought = new Set<GardenWord>(["bird", "owl", "squirrel", "bee", "cat"]);
  const dates = Array.from({ length: 60 }, (_, i) => new Date(2026, 9, 1 + i, 12));

  test("only brought tree visitors come, on some days, the same all day", () => {
    let seen = 0;
    for (const d of dates) {
      const spots = treeVisitorSpots(trees, brought, d);
      seen += spots.length;
      expect(treeVisitorSpots(trees, brought, new Date(d.getTime() + 3600_000))).toEqual(spots);
      for (const s of spots) expect(["bird", "owl", "squirrel", "bee"]).toContain(s.who);
      expect(treeVisitorSpots(trees, new Set<GardenWord>(["cat"]), d)).toEqual([]);
    }
    // Sometimes, not always and not never: about half the days for each of the four.
    expect(seen).toBeGreaterThan(60 * 4 * 0.3);
    expect(seen).toBeLessThan(60 * 4 * 0.7);
  });

  test("each sits by its tree; the bee only by blossom or fruit", () => {
    const byId = new Map(trees.map((t) => [t.id, t]));
    for (const d of dates)
      for (const s of treeVisitorSpots(trees, brought, d)) {
        const t = byId.get(s.tree)!;
        expect(Math.hypot(s.x - t.x, s.z - t.z)).toBeLessThan(t.half + 0.6);
        expect(s.y).toBeLessThanOrEqual(t.height);
        if (s.who === "bee") expect(t.look).not.toBe("leaves");
        if (s.who === "squirrel") expect(s.y).toBe(0);
      }
    const leavesOnly = trees.filter((t) => t.look === "leaves");
    for (const d of dates) expect(treeVisitorSpots(leavesOnly, new Set<GardenWord>(["bee"]), d)).toEqual([]);
    expect(treeVisitorSpots([], brought, dates[0])).toEqual([]);
  });
});
