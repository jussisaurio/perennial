import { expect, test } from "bun:test";
import { MAX_NEW_PER_DAY } from "../core/session";
import type { Learner } from "./learner";
import { canPractise, newWordsToday } from "./practice";

const now = new Date(2026, 9, 12, 15).getTime();
// A learner with `fresh` unseen words and `metToday` words first met today (nothing due).
function learner(fresh: number, metToday: number): Learner {
  const reviews = Array.from({ length: metToday }, (_, i) => ({ word_id: `w${i}`, skill: "read", reviewed_at: new Date(now - 60_000 * (i + 1)).toISOString() }));
  return {
    reviews,
    resolve: (id: string) => id,
    words: new Map(),
    memories: [],
    fresh: () => Array.from({ length: fresh }, (_, i) => `f${i}`),
  } as unknown as Learner;
}

test("new words met today are counted from the first reading review", () => {
  expect(newWordsToday(learner(0, 3), now)).toBe(3);
});

test("Today offers a session only when the session would have something", () => {
  expect(canPractise(learner(10, 0), false, now)).toBe(true); // new words to plant
  expect(canPractise(learner(10, MAX_NEW_PER_DAY), false, now)).toBe(false); // today's new words are in, nothing due
  expect(canPractise(learner(0, 0), false, now)).toBe(false); // course learned, nothing due
});

test("past the day's limits you can keep going (never blocked), when there is anything at all", () => {
  expect(canPractise(learner(10, MAX_NEW_PER_DAY), false, now, true)).toBe(true); // more new words, beyond the limit
  expect(canPractise(learner(0, 0), false, now, true)).toBe(false); // truly nothing: no words left, nothing coming due
});
