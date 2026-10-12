import { describe, expect, mock, test } from "bun:test";
import type { LoadedDeck } from "../data/deck";
import type { Learner } from "../data/learner";
import type { MemoryRow } from "../model";

// The learner model's deck loader needs Vite (import.meta.glob); these tests never load a deck.
mock.module("../data/deck", () => ({ loadDeck: () => Promise.reject(new Error("no decks in tests")), deckLangs: () => [] }));
const { plantStage, isStrong, wordState } = await import("../data/learner");
const { plantMood, plantsFromLearner, showcasePlants, stageLabel, stageSentence, leanDeg, THIRSTY } = await import("./plants");
const { droopFor } = await import("./world");

describe("one definition of a word's stage", () => {
  test("a plant blooms exactly when its word is known", () => {
    for (const m of [{ s: 0, reps: 0 }, { s: 2, reps: 1 }, { s: 5, reps: 3 }, { s: 9, reps: 1 }, { s: 9, reps: 2 }, { s: 300, reps: 9 }]) {
      expect(plantStage(m) === "bloom").toBe(wordState(m) === "known");
      expect(plantStage(m) === "seed").toBe(wordState(m) === "new");
    }
    expect(plantStage(undefined)).toBe("seed");
    // Stable after one lucky review is a bud, not a bloom.
    expect(plantStage({ s: 9, reps: 1 })).toBe("bud");
    expect(plantStage({ s: 2, reps: 1 })).toBe("sprout");
  });

  test("listening and writing dots follow the same rule", () => {
    expect(isStrong({ s: 9, reps: 1 })).toBe(false);
    expect(isStrong({ s: 9, reps: 2 })).toBe(true);
    expect(isStrong(undefined)).toBe(false);
  });

  test("the stage in words is the same everywhere", () => {
    expect(stageLabel("bloom")).toBe("in bloom");
    expect(stageSentence("bud")).toBe("Budding: you almost know this word.");
  });
});

describe("plant moods and lean", () => {
  test("thirsty below THIRSTY, then old friends, then the stage", () => {
    expect(plantMood({ s: 300, r: THIRSTY - 0.01, stage: "bloom" })).toBe("thirsty");
    expect(plantMood({ s: 300, r: 0.95, stage: "bloom" })).toBe("old");
    expect(plantMood({ s: 20, r: 0.95, stage: "bloom" })).toBe("bloom");
    expect(plantMood({ s: 4, r: THIRSTY, stage: "bud" })).toBe("bud");
  });

  test("the walk leans the same way as the strip: the shader turns the other way round", () => {
    for (const id of ["casa", "perro", "mañana", "Blume", "Haus"]) {
      expect(Math.abs(leanDeg(id, 0.95))).toBe(0);
      const deg = leanDeg(id, 0.4);
      expect(Math.abs(deg)).toBe(18);
      expect(droopFor(id, 0.4)).toBeCloseTo((-deg * Math.PI) / 180);
    }
  });
});

describe("garden plants", () => {
  const words = Array.from({ length: 200 }, (_, i) => ({ id: `w${i}`, lemma: `word${i}`, gloss: "", pos: ["noun", "verb", "adj"][i % 3], rank: i, forms: [] }));
  const deck = { words } as unknown as LoadedDeck;

  test("a showcase word is the same plant in a small showcase and a big one", () => {
    const small = showcasePlants(deck, 64).plants;
    const big = new Map(showcasePlants(deck, 160).plants.map((p) => [p.id, p]));
    expect(small).toHaveLength(64);
    for (const p of small) expect(big.get(p.id)).toEqual(p);
    expect(new Set(small.map((p) => p.stage))).toEqual(new Set(["sprout", "bud", "bloom"]));
  });

  test("the learner's plants use the shared stage, dots and order", () => {
    const now = Date.now();
    const row = (id: string, skill: MemoryRow["skill"], s: number, reps: number): MemoryRow => ({ key: `${id}:${skill}`, courseId: "", lexemeId: id, skill, s, d: 5, lastTs: now, due: now, reps, lapses: 0 });
    const memories = [row("w2", "read", 9, 1), row("w1", "read", 9, 2), row("w1", "listen", 8, 2), row("w1", "write", 8, 1), row("w0", "read", 0, 0)];
    const l = {
      words: new Map(words.map((w) => [w.id, { ...w, source: "deck", status: "active" }])),
      memories,
      memory: new Map(memories.map((m) => [m.key, m])),
      reviews: [],
      resolve: (id: string) => id,
      fresh: () => ["w5", "w6"],
    } as unknown as Learner;
    const g = plantsFromLearner(l, now);
    expect(g.plants.map((p) => [p.id, p.stage, p.listen, p.write])).toEqual([
      ["w1", "bloom", true, false],
      ["w2", "bud", false, false],
    ]);
    expect(g.seeds).toBe(2);
    expect(g.first).toBeNull();
  });
});
