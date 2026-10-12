// What a session would practise now: the one place that turns a learner into
// a session plan, so the session and the Today screen agree on whether there
// is anything to do (Today must not offer a session that ends at once).

import { MAX_NEW_PER_DAY, plan, type Plan } from "../core/session";
import { startOfDay } from "../core/day";
import { fsrs as scheduler } from "../core/scheduler";
import type { Learner } from "./learner";

/** New words first met today (the daily new-word limit counts these). */
export function newWordsToday(l: Learner, now = Date.now()): number {
  const dayStart = startOfDay(now);
  const first = new Map<string, number>();
  for (const r of l.reviews) {
    if (r.skill !== "read") continue;
    const id = l.resolve(r.word_id);
    const t = Date.parse(r.reviewed_at);
    const prev = first.get(id);
    if (prev === undefined || t < prev) first.set(id, t);
  }
  return [...first.values()].filter((t) => t >= dayStart).length;
}

/**
 * "Keep going" after the day's practice: more is allowed, never blocked. Up to
 * this many new words beyond today's limit, plus reviews due in the next days
 * (early, so worth a little less, but no harm).
 */
const EXTRA_NEW = 10;

/** The nudge next to "Keep going": a reason, not a rule. */
export const KEEP_GOING_NOTE = "More is fine. New words come back for review over the next days, so tomorrow's session may take a little longer.";
const EXTRA_LOOKAHEAD_MS = 3 * 86_400_000;

/** The session plan for `minutes`; `voice`: listening exercises possible; `extra`: keep going past the day's limits. */
export function sessionPlan(l: Learner, minutes: number, voice: boolean, now = Date.now(), extra = false): Plan {
  const newToday = newWordsToday(l, now);
  const suspended = new Set([...l.words.values()].filter((w) => w.status === "paused" || w.status === "ignored").map((w) => w.id));
  return plan({
    now,
    budgetMs: minutes * 60_000,
    memories: l.memories.filter((m) => (voice || m.skill !== "listen") && !suspended.has(m.wordId)),
    fresh: l.fresh(),
    fsrs: scheduler,
    newToday,
    ...(extra ? { maxNewPerDay: Math.max(MAX_NEW_PER_DAY, newToday) + EXTRA_NEW, lookaheadMs: EXTRA_LOOKAHEAD_MS } : {}),
  });
}

/** Is there anything to practise now (a word due, or a new word still allowed today)? With `extra`: if you keep going. */
export function canPractise(l: Learner, voice: boolean, now = Date.now(), extra = false): boolean {
  return sessionPlan(l, 5, voice, now, extra).queue.length > 0;
}
