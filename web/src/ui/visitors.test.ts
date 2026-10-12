import { describe, expect, mock, test } from "bun:test";
import type { ReviewRow } from "../data/rows";
import { milestoneLine } from "../garden/visitors";

// The deck loader needs Vite (import.meta.glob); these tests never load a deck.
mock.module("../data/deck", () => ({ loadDeck: () => Promise.reject(new Error("no decks in tests")), deckLangs: () => [] }));
const { deriveMemory, wordState } = await import("../data/learner");
const { knownAt, knownWords } = await import("./visitors");

const DAY = 86_400_000;
const start = new Date(2026, 0, 1, 9).getTime();
const review = (word: string, day: number, skill: ReviewRow["skill"] = "read"): ReviewRow => ({
  id: `${word}-${day}-${skill}`,
  user_id: "u",
  lang: "es",
  word_id: word,
  skill,
  grade: 3,
  kind: "review",
  reviewed_at: new Date(start + day * DAY).toISOString(),
  duration_ms: 1000,
  sentence_id: null,
});
const same = (id: string) => id;

describe("known words at the start of a day (for the milestone line)", () => {
  // Each word reviewed well on a growing schedule: known after a few weeks.
  const words = Array.from({ length: 6 }, (_, i) => `w${i}`);
  const reviews = words.flatMap((w, i) => [0, 2, 7, 20, 50].map((d) => review(w, d + i * 30)));
  const ids = new Set(words);
  const knownNow = deriveMemory(reviews, 0.9, same).filter((m) => m.skill === "read" && wordState(m) === "known").length;

  test("counts only reviews before the moment, the same way as the live count", () => {
    expect(knownNow).toBe(words.length);
    expect(knownAt(reviews, Infinity, 0.9, same, ids)).toBe(knownNow);
    expect(knownAt(reviews, start, 0.9, same, ids)).toBe(0);
    // Halfway, some words are known and some are not yet.
    const mid = knownAt(reviews, start + 70 * DAY, 0.9, same, ids);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(words.length);
  });

  test("ignores other skills and words not in the course", () => {
    const extra = [...reviews, ...words.map((w) => review(w, 70, "listen")), ...[0, 2, 7, 20, 50].map((d) => review("gone", d))];
    expect(knownAt(extra, Infinity, 0.9, same, ids)).toBe(words.length);
  });

  test("on the day a word becomes known, the start-of-day count is one lower", () => {
    // The last word starts on day 150. Find the review day that makes it known.
    const dayStart = (d: number) => new Date(2026, 0, 1 + d).getTime();
    const day = [150, 152, 157, 170, 200].find((d) => knownAt(reviews, dayStart(d + 1), 0.9, same, ids) === words.length)!;
    expect(day).toBeDefined();
    expect(knownAt(reviews, dayStart(day), 0.9, same, ids)).toBe(words.length - 1);
    // The same for 25: the line shows only on that day.
    expect(milestoneLine(24, 25)).not.toBeNull();
    expect(milestoneLine(25, 25)).toBeNull();
  });
});

describe("known words for unlocks, milestones and the frog", () => {
  const known = { s: 30, reps: 4 };
  const memoryOf = (ids: string[]) => new Map(ids.map((id) => [`${id}:read`, known]));
  const word = (i: number, pos: string) => ({ id: `${pos}${i}`, lemma: `${pos}-${i}`, pos });

  test("counts every known word, though the frog croaks only nouns once there are five", () => {
    const words = [...Array.from({ length: 6 }, (_, i) => word(i, "noun")), ...Array.from({ length: 30 }, (_, i) => word(i, "verb"))];
    const k = knownWords(words, memoryOf(words.map((w) => w.id)));
    expect(k.count).toBe(36);
    expect(k.croaks).toHaveLength(6);
    expect(k.croaks.every((l) => l.startsWith("noun"))).toBe(true);
    // 36 known words cross the 25 milestone, which the six nouns alone would not.
    expect(milestoneLine(0, k.count)).not.toBeNull();
  });

  test("with few nouns the frog croaks any known word; words not known yet count for nothing", () => {
    const words = [word(0, "noun"), word(1, "verb"), word(2, "verb")];
    const memory = new Map([...memoryOf(["noun0", "verb1"]), ["verb2:read", { s: 30, reps: 1 }]]);
    const k = knownWords(words, memory);
    expect(k.count).toBe(2);
    expect(k.croaks).toEqual(["noun-0", "verb-1"]);
    expect(k.lemmas).toEqual(new Set(["noun-0", "verb-1"]));
  });
});
