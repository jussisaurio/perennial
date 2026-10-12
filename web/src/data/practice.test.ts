import { expect, test } from "bun:test";
import { DAY_MS } from "../core/day";
import type { MemoryRow } from "../core/memory";
import type { Learner } from "./learner";
import { canPractise, sessionPlan } from "./practice";

const now = new Date(2026, 9, 12, 15).getTime();
const due = (id: string): MemoryRow => ({ key: `${id}:read`, wordId: id, skill: "read", s: 5, d: 5, lastTs: now - 10 * DAY_MS, due: now - 5 * DAY_MS, reps: 3, lapses: 0 });

// A learner with `fresh` unseen words, `learned` words all due, and these reviews.
function learner(fresh: number, learned: string[], reviews: { word_id: string; grade: number; reviewed_at: string }[] = []): Learner {
  return {
    reviews: reviews.map((r) => ({ ...r, skill: "read" })),
    resolve: (id: string) => (id === "alias" ? "a" : id),
    words: new Map(),
    memories: learned.map(due),
    fresh: () => Array.from({ length: fresh }, (_, i) => `f${i}`),
  } as unknown as Learner;
}
const at = (t: number) => new Date(t).toISOString();
const words = (l: Learner) => sessionPlan(l, 5, false, now).queue.map((t) => t.wordId);

test("a word answered correctly today (by any of its ids) is not planned again today", () => {
  const l = learner(0, ["a", "b", "c", "d"], [
    { word_id: "alias", grade: 3, reviewed_at: at(now - 3_600_000) }, // "a", this afternoon
    { word_id: "b", grade: 1, reviewed_at: at(now - 3_600_000) }, // forgotten today: still due
    { word_id: "c", grade: 3, reviewed_at: at(now - DAY_MS) }, // yesterday
    { word_id: "d", grade: 4, reviewed_at: at(now - 60_000) }, // "Already know it" today
  ]);
  expect(words(l).sort()).toEqual(["b", "c"]);
});

test("there is always something to practise once there is any word", () => {
  expect(canPractise(learner(10, []), false, now)).toBe(true); // new words to plant
  expect(canPractise(learner(0, ["a"]), false, now)).toBe(true); // course learned: practise what you know
  expect(canPractise(learner(0, []), false, now)).toBe(false); // no words at all
});
