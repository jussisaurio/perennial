import { expect, test } from "bun:test";
import { DAY_MS } from "../core/day";
import type { MemoryRow } from "../core/memory";
import type { Learner } from "./learner";
import { nextChunk, sessionPlan } from "./practice";

const now = new Date(2026, 9, 12, 15).getTime();
const mem = (id: string, dueIn: number): MemoryRow => ({ key: `${id}:read`, wordId: id, skill: "read", s: 5, d: 5, lastTs: now - 10 * DAY_MS, due: now + dueIn * DAY_MS, reps: 3, lapses: 0 });
const due = (id: string) => mem(id, -5);

// A learner with `fresh` unseen words, these memories, and these reviews.
function learner(fresh: number, memories: MemoryRow[], reviews: { word_id: string; grade: number; reviewed_at: string; duration_ms?: number }[] = []): Learner {
  const resolve = (id: string) => (id === "alias" ? "a" : id);
  const rows = reviews.map((r, i) => ({ ...r, id: `r${i}`, skill: "read" }));
  const byWord = new Map<string, typeof rows>();
  for (const r of rows) byWord.set(resolve(r.word_id), [...(byWord.get(resolve(r.word_id)) ?? []), r]);
  return {
    reviews: rows,
    reviewsByWord: byWord,
    resolve,
    words: new Map(),
    memories,
    fresh: () => Array.from({ length: fresh }, (_, i) => `f${i}`),
  } as unknown as Learner;
}
const at = (t: number) => new Date(t).toISOString();
const words = (l: Learner) => sessionPlan(l, 5, false, now).queue.map((t) => t.wordId);

test("a word answered correctly today (by any of its ids) is not planned again today", () => {
  const l = learner(0, ["a", "b", "c", "d"].map(due), [
    { word_id: "alias", grade: 3, reviewed_at: at(now - 3_600_000) }, // "a", this afternoon
    { word_id: "b", grade: 1, reviewed_at: at(now - 3_600_000) }, // forgotten today: still due
    { word_id: "c", grade: 3, reviewed_at: at(now - DAY_MS) }, // yesterday
    { word_id: "d", grade: 4, reviewed_at: at(now - 60_000) }, // "Already know it" today
  ]);
  expect(words(l).sort()).toEqual(["b", "c"]);
});

test("there is always something to practise once there is any word", () => {
  expect(words(learner(10, []))).toHaveLength(10); // new words to plant
  expect(words(learner(0, [mem("a", 30)]))).toEqual(["a"]); // course learned, nothing due for a month: practise what you know
});

test("today's 5 minutes: start, finish the rest, and done once under a minute is left", () => {
  const spent = (...ms: number[]) => nextChunk(learner(10, [], ms.map((d, i) => ({ word_id: `w${i}`, grade: 3, reviewed_at: at(now - 60_000), duration_ms: d }))), now);
  expect(spent()).toEqual({ state: "start", minutes: 5 });
  expect(spent(20_000)).toEqual({ state: "start", minutes: 5 }); // a few seconds is not a session to finish
  expect(spent(60_000, 60_000)).toEqual({ state: "finish", minutes: 3 });
  expect(spent(4 * 60_000 + 5_000)).toEqual({ state: "done", minutes: 5 }); // 55 s left counts as done
  expect(spent(9 * 60_000)).toEqual({ state: "done", minutes: 5 }); // after "Practice 5 more minutes" too
  // Yesterday's minutes do not count today.
  const yesterday = learner(10, [], [{ word_id: "w", grade: 3, reviewed_at: at(now - DAY_MS), duration_ms: 5 * 60_000 }]);
  expect(nextChunk(yesterday, now)).toEqual({ state: "start", minutes: 5 });
});

test("a fast learner who answers all of the day's planned cards is done for the day (#255)", () => {
  // Day one: the planner fills 5 minutes with new words, priced at what a new word usually takes.
  const planned = sessionPlan(learner(40, []), 5, false, now).queue;
  const answers = (tasks: typeof planned) => tasks.map((t) => ({ word_id: t.wordId, grade: 3, reviewed_at: at(now - 60_000), duration_ms: 8_000 }));
  // Each word took 8 s, not the planned 25 s: under 2 real minutes, but every planned card is done.
  expect(nextChunk(learner(40, [], answers(planned)), now)).toEqual({ state: "done", minutes: 5 });
  // Half of them is half of the day: the rest is still to do.
  expect(nextChunk(learner(40, [], answers(planned.slice(0, planned.length / 2))), now)).toEqual({ state: "finish", minutes: 3 });
});

test("only a word's first answer ever counts as a new word; every other answer counts its real time (#255)", () => {
  // 30 plants first answered 10 days ago, each watered today in 2 s: 60 s of real time.
  const old = Array.from({ length: 30 }, (_, i) => ({ word_id: `w${i}`, grade: 3, reviewed_at: at(now - 10 * DAY_MS + i * 1000), duration_ms: 8_000 }));
  const watered = old.map((r, i) => ({ ...r, reviewed_at: at(now - 600_000 + i * 10_000), duration_ms: 2_000 }));
  // One new word: its quick check (5 s, counted as 25 s), then a retry today (3 s, real time).
  const seed = [
    { word_id: "n", grade: 1, reviewed_at: at(now - 200_000), duration_ms: 5_000 },
    { word_id: "n", grade: 3, reviewed_at: at(now - 100_000), duration_ms: 3_000 },
  ];
  // 60 + 25 + 3 = 88 s: 3.5 minutes left.
  expect(nextChunk(learner(40, [], [...old, ...watered, ...seed]), now)).toEqual({ state: "finish", minutes: 4 });
  // Stopping early in a review session keeps the real minutes left: 25 reviews at 3 s.
  const quick = old.slice(0, 25).map((r, i) => ({ ...r, reviewed_at: at(now - 600_000 + i * 10_000), duration_ms: 3_000 }));
  expect(nextChunk(learner(40, [], [...old, ...quick]), now)).toEqual({ state: "finish", minutes: 4 });
});
