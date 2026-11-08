// Time-boxed session planning. There is no "due count" to clear: each chunk of
// practice gets N minutes, and we spend them where they buy the most memory.
// Every chunk is planned on its own, so "Practice more" is just
// another chunk, not a special mode with its own limits.

import type { FSRS, Grade } from "./fsrs";
import { DAY_MS } from "./day";
import type { MemoryRow } from "./memory";
import type { Skill } from "../data/rows";

export type Task =
  | { kind: "intro"; wordId: string }
  | { kind: "review"; wordId: string; skill: Skill; isNew?: boolean; retry?: boolean };

/** The time a new word takes: its new-word card and its quick check. */
export const NEW_WORD_MS = 12_000;

/**
 * Time per task, ms. `intro` covers the intro and its follow-up test.
 * Heuristic prices from how long self-graded cards really take (#311).
 */
const COSTS: Record<"intro" | Skill, number> = { intro: NEW_WORD_MS, read: 5_000, listen: 7_000, write: 12_000 };

/**
 * The share of a chunk's minutes the plan fills. The rest is for slow answers
 * and retries of quick checks; without it, a 60-day simulation (#311) left the
 * weakest due words unwatered at the end of most chunks. Keep the planned new
 * words of a day-1 chunk worth over 4 minutes: nextChunk counts them at
 * NEW_WORD_MS each, and under a minute left is what makes the day done.
 */
const PLANNED_SHARE = 0.9;

/**
 * First practices of listening and typing per chunk. Each takes the place of a
 * due reading review of its word: a remembered answer counts for reading too
 * (memory.ts), so it costs only its extra seconds and the new skill's own
 * reviews. In a 90-day simulation of one 7-minute chunk a day (#852), these
 * heard 152 words and typed 77 by day 90, with 725 known; two extra first
 * practices per chunk (#851) heard 86, typed 82, with 671 known. Typing costs
 * the most (12 s a card): a second one a chunk cost another 120 known words.
 */
const FIRST_PRACTICES: Record<Exclude<Skill, "read">, number> = { listen: 2, write: 1 };

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
 * 1. due reviews, the ones still most likely to be saved first; a few due
 *    reading reviews come as the first practice of their word's listening or typing;
 * 2. new words in the time left (a trickle even during a backlog);
 * 3. reviews due within a day, soonest first;
 * 4. any other learned word, weakest first.
 * Steps 3 and 4 make sure a chunk is never empty once anything is learned.
 * They are not sized to the budget: the timer, not the queue, ends the chunk.
 * A step per memory: Today works it out in slices (#569).
 */
export function* planSteps(input: PlanInput): Generator<void, Plan> {
  const { now, budgetMs, memories, fresh, fsrs, answeredToday } = input;
  const recall = (m: MemoryRow) => fsrs.retrievability((now - m.lastTs) / DAY_MS, m.s);

  // One skill per word per session: practising "listen" right after "read" for
  // the same word mostly measures short-term memory. A skill never practised
  // yet has no memory to save: it comes only in place of its word's due reading.
  const byWord = new Map<string, { m: MemoryRow; r: number }>();
  const unlocked = new Map<string, Partial<Record<Skill, MemoryRow>>>();
  const learned: MemoryRow[] = [];
  for (const m of memories) {
    yield;
    if (answeredToday.has(m.wordId)) continue;
    if (m.reps === 0) {
      const u = unlocked.get(m.wordId);
      if (u) u[m.skill] = m;
      else unlocked.set(m.wordId, { [m.skill]: m });
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
  // A due reading review comes as the first practice of its word's typing or
  // listening instead, the likeliest recalled first: a remembered answer waters
  // the reading too. Typing first, as it unlocks later and so for fewer words.
  const firsts = { listen: 0, write: 0 };
  for (const d of due) {
    const u = d.m.skill === "read" ? unlocked.get(d.m.wordId) : undefined;
    if (!u) continue;
    const skill = (["write", "listen"] as const).find((s) => u[s] && firsts[s] < FIRST_PRACTICES[s]);
    if (!skill) continue;
    firsts[skill]++;
    d.m = u[skill]!; // !: found above
  }
  // A word likely forgotten costs more: a forgotten card comes back as a retry.
  const dueCost = due.reduce((sum, { m, r }) => sum + COSTS[m.skill] * (2 - r), 0);

  // New words fill the time left over. Keep a trickle (1–2) coming even during
  // a backlog so sessions never become pure catch-up, unless the backlog is
  // truly large.
  const free = budgetMs * PLANNED_SHARE - dueCost;
  let byTime = Math.floor(Math.max(0, free) / COSTS.intro);
  // The trickle compares with the whole budget, not the planned share: it is about how big the backlog is.
  if (byTime === 0 && dueCost < 3 * budgetMs) byTime = dueCost < 1.5 * budgetMs ? 2 : 1;
  const newCount = Math.min(byTime, fresh.length);

  // Early reviews for the rest of the time: what comes due soonest, then the
  // weakest of everything else. Practising early is worth a little less, never harm.
  const taken = new Set(byWord.keys());
  const soon = yield* firstPerWord(
    learned.filter((m) => !taken.has(m.wordId) && m.due <= now + DAY_MS),
    (m) => m.due,
  );
  for (const m of soon) taken.add(m.wordId);
  const weakest = yield* firstPerWord(
    learned.filter((m) => !taken.has(m.wordId)),
    recall,
  );

  const reviews: Task[] = due.map(({ m }) => (m.reps ? { kind: "review", wordId: m.wordId, skill: m.skill } : { kind: "review", wordId: m.wordId, skill: m.skill, isNew: true }));
  const intros: Task[] = fresh.slice(0, newCount).map((wordId) => ({ kind: "intro", wordId }));
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
  queue.push(...early);

  // Every learned word was already answered today and no new words are left
  // (a small course, practised a lot): a second try today beats an empty chunk.
  if (!queue.length) {
    const again = yield* firstPerWord(
      memories.filter((m) => m.reps > 0),
      recall,
    );
    queue.push(...again.map((m): Task => ({ kind: "review", wordId: m.wordId, skill: m.skill })));
  }

  return { queue, newCount, due: due.length };
}

/**
 * Each word's first memory by `key`, lowest first, the words in that order too.
 * Each key is worked out once, not in every comparison of the sort: recall is a
 * power, and a big garden sorts thousands of memories when a session starts (#457).
 */
function* firstPerWord(memories: MemoryRow[], key: (m: MemoryRow) => number): Generator<void, MemoryRow[]> {
  const seen = new Set<string>();
  const keyed: { m: MemoryRow; k: number }[] = [];
  for (const m of memories) {
    keyed.push({ m, k: key(m) });
    yield;
  }
  return keyed
    .sort((a, b) => a.k - b.k)
    .map(({ m }) => m)
    .filter((m) => !seen.has(m.wordId) && !!seen.add(m.wordId));
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
  /** The active time this snapshot's `next()` chose its card at. */
  activeMs: number;
}

/**
 * Runs a planned queue against the clock. Near the end, no new word is
 * started. When time is up, only follow-ups that were promised (tests of
 * just-introduced words, retries of forgotten ones) are still served.
 */
export class Session {
  private queue: Task[];
  private followUps: { task: Task; at: number }[] = [];
  private retries = new Map<string, number>();
  private served = 0;
  private history: Snapshot[] = [];
  /** Set by undo: the next `next()` chooses as it did the first time, so the undone card comes back even if time has run out since (#195). */
  private replayAt: number | undefined;
  readonly budgetMs: number;

  constructor(plan: Pick<Plan, "queue">, budgetMs: number) {
    this.queue = [...plan.queue];
    this.budgetMs = budgetMs;
  }

  /** `activeMs` is time the learner has actually spent (see ActiveClock), not wall-clock time. */
  timeUp(activeMs: number): boolean {
    return activeMs >= this.budgetMs;
  }

  /**
   * Why `next()` returned null. Planned cards still queued mean the clock ended
   * the chunk: new words held back in its last seconds, not an empty queue.
   */
  endedBy(activeMs: number): "time" | "empty" {
    return this.timeUp(activeMs) || this.queue.length ? "time" : "empty";
  }

  next(activeMs: number): Task | null {
    const at = this.replayAt ?? activeMs;
    this.replayAt = undefined;
    this.history.push({ queue: [...this.queue], followUps: [...this.followUps], retries: new Map(this.retries), served: this.served, activeMs: at });
    if (this.history.length > 50) this.history.shift();
    const ready = this.followUps.findIndex((f) => f.at <= this.served);
    if (ready >= 0) {
      this.served++;
      return this.followUps.splice(ready, 1)[0].task;
    }
    if (!this.timeUp(at)) {
      // A new word's quick check comes a few cards after it. With less time left
      // than a new word takes, the check would come right after the word (#268):
      // serve other cards, and start no more new words in this chunk.
      const i = this.budgetMs - at >= COSTS.intro ? 0 : this.queue.findIndex((t) => t.kind !== "intro");
      if (i >= 0 && i < this.queue.length) {
        this.served++;
        return this.queue.splice(i, 1)[0];
      }
    }
    // Out of time or queue: drain promised follow-ups immediately.
    if (this.followUps.length) {
      this.served++;
      return this.followUps.shift()!.task;
    }
    return null;
  }

  /** The cards likely to come next, soonest first: promised follow-ups, then the queue. A guess, for loading ahead. */
  upcoming(n: number): Task[] {
    return [...this.followUps].sort((a, b) => a.at - b.at).map((f) => f.task).concat(this.queue).slice(0, n);
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
    this.replayAt = prev.activeMs;
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

  /**
   * Sound went off, or "Can't listen now": no more listening cards this chunk,
   * retries included. Undo's saved states lose them too, so Undo cannot bring
   * one back. The card on screen is the caller's: it passes it over with `skip`.
   */
  dropListening(): void {
    const keep = (t: Task) => t.kind === "intro" || t.skill !== "listen";
    this.queue = this.queue.filter(keep);
    this.followUps = this.followUps.filter((f) => keep(f.task));
    for (const s of this.history) {
      s.queue = s.queue.filter(keep);
      s.followUps = s.followUps.filter((f) => keep(f.task));
    }
  }
}
