// What a session would practise now: the one place that turns a learner into
// a session plan, so the session and the Today screen agree on what it holds.

import { plan, plannedMs, type Plan } from "../core/session";
import { startOfDay } from "../core/day";
import { fsrs as scheduler } from "../core/scheduler";
import type { Learner } from "./learner";

/** Words with a correct answer (grade 2 or better, or "Already know it") today. */
function answeredToday(l: Learner, now: number): Set<string> {
  const dayStart = startOfDay(now);
  const done = new Set<string>();
  for (const r of l.reviews) if (r.grade >= 2 && Date.parse(r.reviewed_at) >= dayStart) done.add(l.resolve(r.word_id));
  return done;
}

/** The session plan for `minutes`; `voice`: listening exercises possible. */
export function sessionPlan(l: Learner, minutes: number, voice: boolean, now = Date.now()): Plan {
  const suspended = new Set([...l.words.values()].filter((w) => w.status === "paused" || w.status === "ignored").map((w) => w.id));
  return plan({
    now,
    budgetMs: minutes * 60_000,
    memories: l.memories.filter((m) => (voice || m.skill !== "listen") && !suspended.has(m.wordId)),
    fresh: l.fresh(),
    fsrs: scheduler,
    answeredToday: answeredToday(l, now),
  });
}

/** Everyone practises 5 minutes a day, and 5 more whenever they like. `course.minutes` is no longer used. */
export const DAILY_MINUTES = 5;

/** What Today offers now: the day's 5 minutes, the rest of them, or (once they are done) 5 more. */
export function nextChunk(l: Learner, now = Date.now()): { state: "start" | "finish" | "done"; minutes: number } {
  const dayStart = startOfDay(now);
  const first = new Map<string, number>();
  for (const r of l.reviews) {
    const id = l.resolve(r.word_id);
    const t = Date.parse(r.reviewed_at);
    if (!first.has(id) || t < first.get(id)!) first.set(id, t);
  }
  // Each answer counts at least the time the plan gave it: a fast learner who
  // answers all of a chunk's cards has done its minutes, even in less real time.
  // Otherwise Today asks for more minutes after every session that ran out of cards (#255).
  let ms = 0;
  for (const r of l.reviews) {
    const t = Date.parse(r.reviewed_at);
    if (t >= dayStart) ms += Math.max(r.duration_ms, plannedMs(r.skill, t === first.get(l.resolve(r.word_id))));
  }
  const left = DAILY_MINUTES - ms / 60_000;
  // Under a minute left counts as done: a session that short is not worth a button.
  if (left < 1) return { state: "done", minutes: DAILY_MINUTES };
  // Half a minute in is a start, not a session to finish.
  if (ms < 30_000) return { state: "start", minutes: DAILY_MINUTES };
  return { state: "finish", minutes: Math.round(left) };
}
