// What a session would practise now: the one place that turns a learner into
// a session plan, so the session and the Today screen agree on what it holds.

import { plan, type Plan } from "../core/session";
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
