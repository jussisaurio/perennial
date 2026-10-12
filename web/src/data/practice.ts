// What a session would practise now: the one place that turns a learner into
// a session plan, so the session and the Today screen agree on whether there
// is anything to do (Today must not offer a session that ends at once).

import { plan, type Plan } from "../core/session";
import { fsrs as scheduler } from "../core/scheduler";
import type { Learner } from "./learner";

/** New words first met today (the daily new-word limit counts these). */
export function newWordsToday(l: Learner, now = Date.now()): number {
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  const first = new Map<string, number>();
  for (const r of l.reviews) {
    if (r.skill !== "read") continue;
    const id = l.resolve(r.word_id);
    const t = Date.parse(r.reviewed_at);
    const prev = first.get(id);
    if (prev === undefined || t < prev) first.set(id, t);
  }
  return [...first.values()].filter((t) => t >= startOfDay).length;
}

/** The session plan for `minutes`; `voice`: listening exercises possible. */
export function sessionPlan(l: Learner, minutes: number, voice: boolean, now = Date.now()): Plan {
  const suspended = new Set([...l.words.values()].filter((w) => w.status === "paused" || w.status === "ignored").map((w) => w.id));
  return plan({
    now,
    budgetMs: minutes * 60_000,
    memories: l.memories.filter((m) => (voice || m.skill !== "listen") && !suspended.has(m.lexemeId)),
    fresh: l.fresh(),
    fsrs: scheduler,
    newToday: newWordsToday(l, now),
  });
}

/** Is there anything to practise now (a word due, or a new word still allowed today)? */
export function canPractise(l: Learner, voice: boolean, now = Date.now()): boolean {
  return sessionPlan(l, 5, voice, now).queue.length > 0;
}
