// What a session would practise now: the one place that turns a learner into
// a session plan, so the session and the Today screen agree on what it holds.

import { NEW_WORD_MS, planSteps, type Plan } from "../core/session";
import { startOfDay } from "../core/day";
import { reviewedAt, type MemoryRow } from "../core/memory";
import { fsrs as scheduler } from "../core/scheduler";
import { runAll } from "../lib/yield";
import type { Learner } from "./learner";
import type { ReviewRow } from "./rows";

/** Words with a correct answer (grade 2 or better, or "Already know it") today. */
function answeredToday(l: Learner, now: number): Set<string> {
  const dayStart = startOfDay(now);
  const done = new Set<string>();
  for (const r of l.reviewsSince(dayStart)) if (r.grade >= 2) done.add(l.resolve(r.word_id));
  return done;
}

/** The session plan for `minutes`; `voice`: listening exercises possible. */
export function sessionPlan(l: Learner, minutes: number, voice: boolean, now: number): Plan {
  return runAll(sessionPlanSteps(l, minutes, voice, now));
}

/** sessionPlan a step at a time, with the learner's upcoming(): Today works it out in slices (#569). */
export function* sessionPlanSteps(l: Learner, minutes: number, voice: boolean, now: number): Generator<void, Plan> {
  const fresh = yield* l.freshSteps();
  const suspended = new Set<string>();
  for (const w of l.words.values()) {
    if (w.status === "paused" || w.status === "ignored") suspended.add(w.id);
    yield;
  }
  const memories: MemoryRow[] = [];
  const knewIt = new Set<string>();
  for (const m of l.memories) {
    if ((voice || m.skill !== "listen") && !suspended.has(m.wordId)) memories.push(m);
    // One answer that waters reading, and it was "I knew it". !: a practised memory's reviews are listed under its word.
    if (m.skill === "read" && m.reps === 1 && l.reviewsByWord.get(m.wordId)!.some((r) => r.kind === "known")) knewIt.add(m.wordId);
    yield;
  }
  return yield* planSteps({
    now,
    budgetMs: minutes * 60_000,
    memories,
    fresh,
    fsrs: scheduler,
    answeredToday: answeredToday(l, now),
    knewIt,
  });
}

/** A word's first answer ever: its quick check, or "Already know it". */
function isFirstAnswer(l: Learner, r: ReviewRow): boolean {
  // !: every review is listed under its resolved word.
  const first = l.reviewsByWord.get(l.resolve(r.word_id))!.reduce((a, b) => (reviewedAt(b) < reviewedAt(a) ? b : a));
  return first.id === r.id;
}

/** Everyone practises 5 minutes a day, and 5 more whenever they like. `course.minutes` is no longer used. */
export const DAILY_MINUTES = 5;

/**
 * What a button that starts the next chunk says, on Today, in the walk (#263) and
 * on the summary. No minutes: a chunk is planned work, and a fast learner can finish
 * "5 minutes" of it in two, so a label with minutes would be wrong (#310).
 */
export function chunkLabel(c: { state: "start" | "finish" | "done" }): string {
  return c.state === "done" ? "Practice more" : c.state === "finish" ? "Finish today's practice" : "Start today's practice";
}

/**
 * The time an answer counts toward the day's minutes. A new word counts at least the time the plan gave it: a fast learner who plants
 * all of a chunk's new words has done its minutes, even in less real time.
 * Otherwise Today asks for more minutes after every chunk that ran out of new words (#255).
 * Every other answer counts its real time: the timer, not the plan, ends reviews.
 * @internal Exported for the real-use report (realUse/report.ts).
 */
export const countedMs = (durationMs: number, firstAnswer: boolean) => (firstAnswer ? Math.max(durationMs, NEW_WORD_MS) : durationMs);

/**
 * The day's minutes are done with under a minute left: a session that short is not worth a button.
 * @internal Exported for the real-use report (realUse/report.ts).
 */
export const dayDone = (countedToday: number) => DAILY_MINUTES - countedToday / 60_000 < 1;

/** What Today offers now: the day's 5 minutes, the rest of them, or (once they are done) 5 more. */
export function nextChunk(l: Learner, now = Date.now()): { state: "start" | "finish" | "done"; minutes: number } {
  const dayStart = startOfDay(now);
  let ms = 0;
  for (const r of l.reviewsSince(dayStart)) ms += countedMs(r.duration_ms, isFirstAnswer(l, r));
  if (dayDone(ms)) return { state: "done", minutes: DAILY_MINUTES };
  const left = DAILY_MINUTES - ms / 60_000;
  // Half a minute in is a start, not a session to finish.
  if (ms < 30_000) return { state: "start", minutes: DAILY_MINUTES };
  return { state: "finish", minutes: Math.round(left) };
}
