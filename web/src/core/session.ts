// Time-boxed session planning. There is no "due count" to clear: the learner
// gives us N minutes and we spend them where they buy the most memory.

import type { FSRS, Grade } from "./fsrs";
import { DAY_MS } from "./fsrs";
import type { MemoryRow, Skill } from "../model";

export type Task =
  | { kind: "intro"; lexemeId: string }
  | { kind: "review"; lexemeId: string; skill: Skill; isNew?: boolean; retry?: boolean };

export interface Costs {
  intro: number; // ms for intro + its follow-up test
  read: number;
  listen: number;
  write: number;
}

export const DEFAULT_COSTS: Costs = { intro: 25_000, read: 8_000, listen: 10_000, write: 14_000 };

export interface PlanInput {
  now: number;
  budgetMs: number;
  memories: MemoryRow[];
  /** Not-yet-introduced lexemes, best first. */
  fresh: string[];
  fsrs: FSRS;
  costs?: Costs;
  /** New words per day (not per session, so "practise more" can't stack them). */
  maxNewPerDay?: number;
  /** New words already introduced today. */
  newToday?: number;
  /** First practice of a newly unlocked skill (listening, writing), per session. */
  maxNewSkills?: number;
  /** Review items due up to this far ahead, since the next session may be a day away. */
  lookaheadMs?: number;
}

export interface Plan {
  queue: Task[];
  dueCount: number; // for the planner's own accounting; not shown as a to-do number
  newCount: number;
  /** True when the daily new-word limit (not the timer) is what keeps the session short. */
  newLimitReached: boolean;
}

export const MAX_NEW_PER_DAY = 15;

export function plan(input: PlanInput): Plan {
  const { now, budgetMs, memories, fresh, fsrs } = input;
  const costs = input.costs ?? DEFAULT_COSTS;
  const newLeftToday = Math.max(0, (input.maxNewPerDay ?? MAX_NEW_PER_DAY) - (input.newToday ?? 0));
  const maxNewSkills = input.maxNewSkills ?? 4;
  const horizon = now + (input.lookaheadMs ?? 6 * 3_600_000);

  // One skill per word per session: practising "listen" right after "read" for
  // the same word mostly measures short-term memory. A skill never practised
  // yet has no memory to save, so it never competes with real reviews.
  const byLexeme = new Map<string, { m: MemoryRow; r: number }>();
  const unlocked = new Map<string, MemoryRow>();
  for (const m of memories) {
    if (m.reps === 0) {
      if (!unlocked.has(m.lexemeId)) unlocked.set(m.lexemeId, m);
      continue;
    }
    if (m.due > horizon) continue;
    const r = fsrs.retrievability((now - m.lastTs) / DAY_MS, m.s);
    const cur = byLexeme.get(m.lexemeId);
    if (!cur || r < cur.r) byLexeme.set(m.lexemeId, { m, r });
  }

  // Triage order: items still likely to be recalled first. A word at R=0.85
  // is saved cheaply today; one at R=0.3 is mostly gone and costs the same
  // to relearn tomorrow. This is what makes a week-long break painless.
  const due = [...byLexeme.values()].sort((a, b) => b.r - a.r);
  const dueCost = due.reduce((sum, { m }) => sum + costs[m.skill], 0);

  // New words fill the time left over. Keep a trickle (1–2) coming even during
  // a backlog so sessions never become pure catch-up, unless the backlog is
  // truly large.
  const free = budgetMs - dueCost;
  let byTime = Math.floor(Math.max(0, free) / costs.intro);
  if (byTime === 0 && dueCost < 3 * budgetMs) byTime = dueCost < 1.5 * budgetMs ? 2 : 1;
  const newCount = Math.min(byTime, newLeftToday, fresh.length);
  const newLimitReached = byTime > newCount && newCount === newLeftToday && fresh.length > newCount;

  // Newly unlocked skills: a small trickle with the leftover time, for words
  // that have no real review in this session.
  const spare = free - newCount * costs.intro;
  const newSkills = [...unlocked.values()]
    .filter((m) => !byLexeme.has(m.lexemeId))
    .slice(0, Math.max(0, Math.min(maxNewSkills, Math.floor(spare / costs.write))));

  const reviews: Task[] = due.map(({ m }) => ({ kind: "review", lexemeId: m.lexemeId, skill: m.skill }));
  const intros: Task[] = fresh.slice(0, newCount).map((lexemeId) => ({ kind: "intro", lexemeId }));
  const skills: Task[] = newSkills.map((m) => ({ kind: "review", lexemeId: m.lexemeId, skill: m.skill, isNew: true }));

  // Interleave: spread intros through the first part of the session so new
  // material doesn't all land at the end (and get cut off by the timer).
  const queue: Task[] = [];
  const gap = intros.length ? Math.max(1, Math.floor(Math.min(reviews.length, 20) / intros.length)) : 0;
  let ri = 0;
  for (const intro of intros) {
    for (let k = 0; k < gap && ri < reviews.length; k++) queue.push(reviews[ri++]);
    queue.push(intro);
  }
  while (ri < reviews.length) queue.push(reviews[ri++]);
  queue.push(...skills);

  return { queue, dueCount: due.length, newCount, newLimitReached };
}

export interface Outcome {
  grade?: Grade; // undefined for an intro
  alreadyKnown?: boolean; // intro skipped with "Already know it"
}

const FOLLOW_UP_GAP = 3;
const RETRY_GAP = 4;
const MAX_RETRIES = 2;

/**
 * Runs a planned queue against the clock. When time is up, only follow-ups
 * that were promised (tests of just-introduced words, retries of forgotten
 * ones) are still served.
 */
interface Snapshot {
  queue: Task[];
  followUps: { task: Task; at: number }[];
  retries: Map<string, number>;
  served: number;
}

export class Session {
  private queue: Task[];
  private followUps: { task: Task; at: number }[] = [];
  private retries = new Map<string, number>();
  private served = 0;
  private history: Snapshot[] = [];
  readonly budgetMs: number;

  constructor(plan: Plan, budgetMs: number) {
    this.queue = [...plan.queue];
    this.budgetMs = budgetMs;
  }

  /** `activeMs` is time the learner has actually spent (see ActiveClock), not wall-clock time. */
  timeUp(activeMs: number): boolean {
    return activeMs >= this.budgetMs;
  }

  next(activeMs: number): Task | null {
    this.history.push({ queue: [...this.queue], followUps: [...this.followUps], retries: new Map(this.retries), served: this.served });
    if (this.history.length > 50) this.history.shift();
    const ready = this.followUps.findIndex((f) => f.at <= this.served);
    if (ready >= 0) {
      this.served++;
      return this.followUps.splice(ready, 1)[0].task;
    }
    if (!this.timeUp(activeMs) && this.queue.length) {
      this.served++;
      return this.queue.shift()!;
    }
    // Out of time or queue: drain promised follow-ups immediately.
    if (this.followUps.length) {
      this.served++;
      return this.followUps.shift()!.task;
    }
    return null;
  }

  /** Returns true when a forgotten item was queued for another try this session. */
  report(task: Task, outcome: Outcome): boolean {
    if (task.kind === "intro") {
      if (!outcome.alreadyKnown) {
        this.followUps.push({
          task: { kind: "review", lexemeId: task.lexemeId, skill: "read", isNew: true },
          at: this.served + FOLLOW_UP_GAP,
        });
      }
      return false;
    }
    if (outcome.grade === 1) {
      const key = `${task.lexemeId}:${task.skill}`;
      const n = this.retries.get(key) ?? 0;
      if (n < MAX_RETRIES) {
        this.retries.set(key, n + 1);
        this.followUps.push({ task: { ...task, retry: true }, at: this.served + RETRY_GAP });
        return true;
      }
    }
    return false;
  }

  /**
   * Step back one card: restores the state from before the previous `next()`
   * so that card is served again. Returns false when there's nothing to undo.
   * The caller must also revert whatever it recorded for that card.
   */
  undo(): boolean {
    // The top snapshot belongs to the card currently on screen; drop it and
    // restore the one before, which re-serves the previous card.
    if (this.history.length < 2) return false;
    this.history.pop();
    const prev = this.history.pop()!;
    this.queue = prev.queue;
    this.followUps = prev.followUps;
    this.retries = prev.retries;
    this.served = prev.served;
    return true;
  }

  /**
   * The card just served was passed over without an answer (no sound, or its
   * word is gone): forget its snapshot so that Undo steps over it, back to the
   * last answered card, instead of re-serving it.
   */
  skip(): void {
    this.history.pop();
  }

  get remaining(): number {
    return this.queue.length + this.followUps.length;
  }
}
