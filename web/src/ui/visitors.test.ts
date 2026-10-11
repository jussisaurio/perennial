import { describe, expect, mock, test } from "bun:test";
import type { ReviewRow } from "../data/rows";
import { milestoneLine } from "../garden/visitors";

// The deck loader needs Vite (import.meta.glob); these tests never load a deck.
mock.module("../data/deck", () => ({ loadDeck: () => Promise.reject(new Error("no decks in tests")), deckLangs: () => [] }));
const { deriveMemory, wordState } = await import("../data/learner");
const { knownAt } = await import("./visitors");

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
