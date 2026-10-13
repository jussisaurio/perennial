// Time-boxed session planning. There is no "due count" to clear: each chunk of
// practice gets N minutes, and we spend them where they buy the most memory.
// Every chunk is planned on its own, so "Practice 5 more minutes" is just
// another chunk, not a special mode with its own limits.

import type { FSRS, Grade } from "./fsrs";
import { DAY_MS } from "./day";
import type { MemoryRow } from "./memory";
import type { Skill } from "../data/rows";

export type Task =
  | { kind: "intro"; wordId: string }
  | { kind: "review"; wordId: string; skill: Skill; isNew?: boolean; retry?: boolean };

/** Time per task, ms. `intro` covers the intro and its follow-up test. */
const COSTS: Record<"intro" | Skill, number> = { intro: 25_000, read: 8_000, listen: 10_000, write: 14_000 };

/** First practice of a newly unlocked skill (listening, writing), per session. */
const MAX_NEW_SKILLS = 4;

export interface PlanInput {
  now: number;
  budgetMs: number;
  memories: MemoryRow[];
  /** Not-yet-introduced words, best first. */
  fresh: string[];
  fsrs: FSRS;
  /** Words answered correctly today: not quizzed again until tomorrow. */
  answeredToday: ReadonlySet<string>;
}

export interface Plan {
  queue: Task[];
  newCount: number;
  /** Words due now (step 1): what still needs water today. */
  due: number;
}

/** Review items due up to this far ahead count as due now, since the next session may be a day away. */
const DUE_HORIZON_MS = 6 * 3_600_000;

/**
 * One chunk of practice, filled in this order:
 * 1. due reviews, the ones still most likely to be saved first;
 * 2. new words in the time left (a trickle even during a backlog);
 * 3. the first practice of newly unlocked skills;
 * 4. reviews due within a day, soonest first;
 * 5. any other learned word, weakest first.
 * Steps 4 and 5 make sure a chunk is never empty once anything is learned.
 * They are not sized to the budget: the timer, not the queue, ends the chunk.
 */
export function plan(input: PlanInput): Plan {
  const { now, budgetMs, memories, fresh, fsrs, answeredToday } = input;
  const recall = (m: MemoryRow) => fsrs.retrievability((now - m.lastTs) / DAY_MS, m.s);

  // One skill per word per session: practising "listen" right after "read" for
  // the same word mostly measures short-term memory. A skill never practised
  // yet has no memory to save, so it never competes with real reviews.
  const byWord = new Map<string, { m: MemoryRow; r: number }>();
  const unlocked = new Map<string, MemoryRow>();
  const learned: MemoryRow[] = [];
  for (const m of memories) {
    if (answeredToday.has(m.wordId)) continue;
    if (m.reps === 0) {
      if (!unlocked.has(m.wordId)) unlocked.set(m.wordId, m);
      continue;
    }
    learned.push(m);
    if (m.due > now + DUE_HORIZON_MS) continue;
    const r = recall(m);
    const cur = byWord.get(m.wordId);
    if (!cur || r < cur.r) byWord.set(m.wordId, { m, r });
  }

  // Triage order: items still likely to be recalled first. A word at R=0.85
  // is saved cheaply today; one at R=0.3 is mostly gone and costs the same
  // to relearn tomorrow. This is what makes a week-long break painless.
  const due = [...byWord.values()].sort((a, b) => b.r - a.r);
  const dueCost = due.reduce((sum, { m }) => sum + COSTS[m.skill], 0);

  // New words fill the time left over. Keep a trickle (1–2) coming even during
  // a backlog so sessions never become pure catch-up, unless the backlog is
  // truly large.
  const free = budgetMs - dueCost;
  let byTime = Math.floor(Math.max(0, free) / COSTS.intro);
  if (byTime === 0 && dueCost < 3 * budgetMs) byTime = dueCost < 1.5 * budgetMs ? 2 : 1;
  const newCount = Math.min(byTime, fresh.length);

  // Newly unlocked skills: a small trickle with the leftover time, for words
  // that have no real review in this session.
  const spare = free - newCount * COSTS.intro;
  const newSkills = [...unlocked.values()]
    .filter((m) => !byWord.has(m.wordId))
    .slice(0, Math.max(0, Math.min(MAX_NEW_SKILLS, Math.floor(spare / COSTS.write))));

  // Early reviews for the rest of the time: what comes due soonest, then the
  // weakest of everything else. Practising early is worth a little less, never harm.
  const taken = new Set([...byWord.keys(), ...newSkills.map((m) => m.wordId)]);
  const soon = firstPerWord(
    learned.filter((m) => !taken.has(m.wordId) && m.due <= now + DAY_MS),
    (a, b) => a.due - b.due,
  );
  for (const m of soon) taken.add(m.wordId);
  const weakest = firstPerWord(
    learned.filter((m) => !taken.has(m.wordId)),
    (a, b) => recall(a) - recall(b),
  );

  const reviews: Task[] = due.map(({ m }) => ({ kind: "review", wordId: m.wordId, skill: m.skill }));
  const intros: Task[] = fresh.slice(0, newCount).map((wordId) => ({ kind: "intro", wordId }));
  const skills: Task[] = newSkills.map((m) => ({ kind: "review", wordId: m.wordId, skill: m.skill, isNew: true }));
  const early: Task[] = [...soon, ...weakest].map((m) => ({ kind: "review", wordId: m.wordId, skill: m.skill }));

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
  queue.push(...skills, ...early);

  // Every learned word was already answered today and no new words are left
  // (a small course, practised a lot): a second try today beats an empty chunk.
  if (!queue.length) {
    const again = firstPerWord(
      memories.filter((m) => m.reps > 0),
      (a, b) => recall(a) - recall(b),
    );
    queue.push(...again.map((m): Task => ({ kind: "review", wordId: m.wordId, skill: m.skill })));
  }

  return { queue, newCount, due: due.length };
}

/** Each word's first memory in `order`, the words in that order too. */
function firstPerWord(memories: MemoryRow[], order: (a: MemoryRow, b: MemoryRow) => number): MemoryRow[] {
  const seen = new Set<string>();
  return [...memories].sort(order).filter((m) => !seen.has(m.wordId) && !!seen.add(m.wordId));
}

export interface Outcome {
  grade?: Grade; // undefined for an intro
  alreadyKnown?: boolean; // intro skipped with "Already know it"
}

const FOLLOW_UP_GAP = 3;
const RETRY_GAP = 4;
const MAX_RETRIES = 2;

interface Snapshot {
  queue: Task[];
  followUps: { task: Task; at: number }[];
  retries: Map<string, number>;
  served: number;
  /** Whether time was up when this snapshot's `next()` chose its card. */
  late: boolean;
}

/**
 * Runs a planned queue against the clock. When time is up, only follow-ups
 * that were promised (tests of just-introduced words, retries of forgotten
 * ones) are still served.
 */
export class Session {
  private queue: Task[];
  private followUps: { task: Task; at: number }[] = [];
  private retries = new Map<string, number>();
  private served = 0;
  private history: Snapshot[] = [];
  /** Set by undo: the next `next()` chooses as it did the first time, so the undone card comes back even if time has run out since (#195). */
  private replayLate: boolean | undefined;
  readonly budgetMs: number;

  constructor(plan: Pick<Plan, "queue">, budgetMs: number) {
    this.queue = [...plan.queue];
    this.budgetMs = budgetMs;
  }

  /** `activeMs` is time the learner has actually spent (see ActiveClock), not wall-clock time. */
  timeUp(activeMs: number): boolean {
    return activeMs >= this.budgetMs;
  }

  next(activeMs: number): Task | null {
    const late = this.replayLate ?? this.timeUp(activeMs);
    this.replayLate = undefined;
    this.history.push({ queue: [...this.queue], followUps: [...this.followUps], retries: new Map(this.retries), served: this.served, late });
    if (this.history.length > 50) this.history.shift();
    const ready = this.followUps.findIndex((f) => f.at <= this.served);
    if (ready >= 0) {
      this.served++;
      return this.followUps.splice(ready, 1)[0].task;
    }
    if (!late && this.queue.length) {
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
          task: { kind: "review", wordId: task.wordId, skill: "read", isNew: true },
          at: this.served + FOLLOW_UP_GAP,
        });
      }
      return false;
    }
    if (outcome.grade === 1) {
      const key = `${task.wordId}:${task.skill}`;
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
    this.replayLate = prev.late;
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
}
