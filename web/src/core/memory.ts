// Memory: what the review log says about each word and skill. FSRS replays
// the reviews into stability and due dates; from those follow a word's state
// (new, learning, known), its plant and which harder skills are unlocked.
// Pure functions of the reviews, so every device derives the same.

import { DAY_MS } from "./day";
import { replay, type Grade } from "./fsrs";
import { fsrs } from "./scheduler";
import type { ReviewRow, Skill } from "../data/rows";

/** Harder skills unlock once reading is established (read stability in days). */
const UNLOCK: Record<Exclude<Skill, "read">, number> = { listen: 4, write: 10 };
/** A word counts as known once its reading memory is stable for a week, recalled at least twice. */
const KNOWN_STABILITY = 7;

/** Derived from reviews; never stored or synced. `reps === 0` means unlocked but not yet practised. */
export interface MemoryRow {
  key: string; // `${wordId}:${skill}`
  wordId: string;
  skill: Skill;
  s: number;
  d: number;
  lastTs: number;
  due: number;
  reps: number;
  lapses: number;
}

export type WordState = "new" | "learning" | "known";

export function wordState(read: Pick<MemoryRow, "s" | "reps"> | undefined): WordState {
  if (!read || read.reps === 0) return "new";
  return read.s >= KNOWN_STABILITY && read.reps >= 2 ? "known" : "learning";
}

/** The rule of wordState in words: every screen that explains "known" says it this way (#261). */
export const KNOWN_RULE = "A word counts as known when you remembered it at least twice and you will most likely still remember it a week from now.";

/** Read stability (days) at which a learning word shows a bud instead of a sprout. */
export const BUD_S = 3;
/** Read stability (days) of a word known for ages: its plant talks like an old-timer. */
export const OLD_S = 200;
export type PlantStage = "seed" | "sprout" | "bud" | "bloom";

/** A word's plant from its reading memory: the one definition every garden, list and card uses. It blooms exactly when the word is known. */
export function plantStage(read: Pick<MemoryRow, "s" | "reps"> | undefined): PlantStage {
  const st = wordState(read);
  return st === "new" ? "seed" : st === "known" ? "bloom" : read!.s >= BUD_S ? "bud" : "sprout";
}

/** A listening or writing memory strong enough for its dot on the plant: known by the same rule as reading. */
export const isStrong = (m: Pick<MemoryRow, "s" | "reps"> | undefined): boolean => wordState(m) === "known";

/** A gap this short is not news, even when it is a word's longest yet. */
const RECORD_MIN_DAYS = 14;

/**
 * Whole days since the last of `times` (a word's earlier reviews, ms), when that
 * is at least two weeks and longer than any gap before it: the longest this word
 * has waited and still been remembered. Otherwise null.
 */
export function recordGap(times: number[], now: number): number | null {
  if (!times.length) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const gap = now - sorted[sorted.length - 1];
  for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] >= gap) return null;
  const days = Math.floor(gap / DAY_MS);
  return days >= RECORD_MIN_DAYS ? days : null;
}

export function recall(m: MemoryRow, now = Date.now()): number {
  return m.reps ? fsrs.retrievability((now - m.lastTs) / DAY_MS, m.s) : 0;
}

export const memKey = (wordId: string, skill: Skill) => `${wordId}:${skill}`;

const reviewTimes = new WeakMap<ReviewRow, number>();

/**
 * When a review was made (ms), parsed once per row: each screen reads every
 * review's time, and parsing them all again on every new learner was slow
 * (#479). A changed review is a new row object, so it is parsed again.
 */
export function reviewedAt(r: ReviewRow): number {
  let t = reviewTimes.get(r);
  if (t === undefined) {
    t = Date.parse(r.reviewed_at);
    reviewTimes.set(r, t);
  }
  return t;
}

/** A word's reading memory, which decides its state and its plant. */
export function readMemory<M>(l: { memory: { get: (key: string) => M | undefined } }, wordId: string): M | undefined {
  return l.memory.get(memKey(wordId, "read"));
}

/**
 * The words known just before `t` (ms): what a replay of the reading reviews
 * before `t` would say. Only words read since `t` are replayed: for the
 * others, that replay is their memory now.
 */
export function knownAt(l: { words: ReadonlyMap<string, unknown>; memory: ReadonlyMap<string, MemoryRow>; reviewsByWord: ReadonlyMap<string, readonly ReviewRow[]>; course: { retention: number } }, t: number): Set<string> {
  const known = new Set<string>();
  for (const id of l.words.keys()) {
    const now = readMemory(l, id);
    if (!now) continue;
    if (now.lastTs < t) {
      if (wordState(now) === "known") known.add(id);
      continue;
    }
    // A word read since `t` has reviews, listed under it.
    const before = l.reviewsByWord
      .get(id)!
      .filter((r) => r.skill === "read" && reviewedAt(r) < t)
      .map((r) => ({ ts: reviewedAt(r), grade: r.grade }));
    if (wordState(replay(fsrs, before, l.course.retention, memKey(id, "read")) ?? undefined) === "known") known.add(id);
  }
  return known;
}

/** Fold reviews into memory rows per word and skill, plus unlocked-but-unpractised skills. */
export function deriveMemory(reviews: readonly ReviewRow[], retention: number, resolve: (id: string) => string): MemoryRow[] {
  const log = new MemoryLog(retention, resolve);
  for (const r of reviews) log.set(r);
  return log.rows();
}

interface Group {
  wordId: string;
  skill: Skill;
  /** In the order the reviews came, as they are in the log. */
  list: { id: string; ts: number; grade: Grade }[];
  /** Undefined: changed since the last replay. Null: no reviews. */
  row: MemoryRow | null | undefined;
}

/**
 * The memory of a review log that changes one review at a time: a change
 * replays only its own word and skill, not the whole log, and the other rows
 * stay the same objects. rows() always equals deriveMemory over the same
 * reviews in the same order. The order matters: the planner breaks ties by
 * it, so a group keeps the place of its first review.
 */
export class MemoryLog {
  private readonly groups = new Map<string, Group>();
  /** Which group each review is in. */
  private readonly keyOf = new Map<string, string>();
  readonly retention: number;
  private readonly resolve: (id: string) => string;
  /** The rows of the groups, in the order of the groups, and where each group's row is. */
  private readonly replayed: MemoryRow[] = [];
  private readonly at = new Map<string, number>();
  /** The unlocked but unpractised rows, in the order of their words' reading rows, and each by its key. */
  private unlocked: MemoryRow[] = [];
  private readonly unlockedBy = new Map<string, MemoryRow>();
  /** Groups changed since the last rows(); null: build every row again (a group went away, or rows() was never asked). */
  private changed: Set<string> | null = null;
  private cached: MemoryRow[] | null = null;
  /** The words whose rows the last rows() changed; null when it built them all. */
  touched: ReadonlySet<string> | null = null;

  constructor(retention: number, resolve: (id: string) => string) {
    this.retention = retention;
    this.resolve = resolve;
  }

  /** Add a review at the end of the log, or change one in its place. False when the change moves it to another word or skill: then build a new log. */
  set(r: ReviewRow): boolean {
    const wordId = this.resolve(r.word_id);
    const key = memKey(wordId, r.skill);
    const was = this.keyOf.get(r.id);
    if (was !== undefined && was !== key) return false;
    let g = this.groups.get(key);
    if (!g) {
      g = { wordId, skill: r.skill, list: [], row: undefined };
      this.groups.set(key, g);
    }
    const entry = { id: r.id, ts: reviewedAt(r), grade: r.grade };
    const i = was === undefined ? -1 : g.list.findIndex((e) => e.id === r.id);
    if (i >= 0) g.list[i] = entry;
    else g.list.push(entry);
    this.keyOf.set(r.id, key);
    g.row = undefined;
    this.changed?.add(key);
    this.cached = null;
    return true;
  }

  /**
   * Take a review out of the log. False when that moves its group's place in
   * the order (it was the group's first review, and others remain): then
   * build a new log.
   */
  delete(id: string): boolean {
    const key = this.keyOf.get(id);
    if (key === undefined) return true;
    const g = this.groups.get(key)!;
    const i = g.list.findIndex((e) => e.id === id);
    if (i === 0 && g.list.length > 1) return false;
    g.list.splice(i, 1);
    this.keyOf.delete(id);
    g.row = undefined;
    // A group that goes moves every row after it: rare (an undo), so the rows are built again.
    if (!g.list.length) {
      this.groups.delete(key);
      this.changed = null;
    } else this.changed?.add(key);
    this.cached = null;
    return true;
  }

  rows(): MemoryRow[] {
    if (this.cached) {
      this.touched = new Set();
      return this.cached;
    }
    if (this.changed) this.patch(this.changed);
    else this.build();
    this.changed = new Set();
    this.cached = this.replayed.concat(this.unlocked);
    return this.cached;
  }

  /** The row of one word and skill, as of the last rows(). */
  get(key: string): MemoryRow | undefined {
    // Every group has its row by then; a key with no group may be unlocked.
    return this.groups.get(key)?.row ?? this.unlockedBy.get(key);
  }

  private replay(key: string, g: Group): MemoryRow {
    if (g.row === undefined) {
      const st = replay(fsrs, g.list, this.retention, key);
      g.row = st && { key, wordId: g.wordId, skill: g.skill, ...st };
    }
    // Every group in the log has reviews, and reviews replay to a row.
    return g.row!;
  }

  private build() {
    this.replayed.length = 0;
    this.at.clear();
    for (const [key, g] of this.groups) {
      this.at.set(key, this.replayed.length);
      this.replayed.push(this.replay(key, g));
    }
    this.unlockedBy.clear();
    this.unlocked = this.unlockAll();
    this.touched = null;
  }

  /** Only the changed groups, and the unlocks of their words. */
  private patch(keys: Set<string>) {
    const words = new Set<string>();
    for (const key of keys) {
      const g = this.groups.get(key)!;
      const row = this.replay(key, g);
      const i = this.at.get(key);
      // A new group comes last, as in the map.
      if (i === undefined) {
        this.at.set(key, this.replayed.length);
        this.replayed.push(row);
      } else this.replayed[i] = row;
      words.add(g.wordId);
    }
    // An unlock that stays keeps its place, and one that goes (its first answer) leaves the rest in order. Only a new unlock needs the order of the reading rows.
    let added = false;
    const fresh = new Map<string, MemoryRow>();
    const gone = new Set<string>();
    for (const wordId of words) {
      for (const skill of ["listen", "write"] as const) {
        const key = memKey(wordId, skill);
        const row = this.unlock(wordId, skill);
        if (row && !this.unlockedBy.has(key)) added = true;
        if (!row && this.unlockedBy.has(key)) gone.add(key);
        if (row) fresh.set(key, row);
      }
    }
    for (const key of gone) this.unlockedBy.delete(key);
    for (const [key, row] of fresh) this.unlockedBy.set(key, row);
    if (added) this.unlocked = this.unlockAll();
    else if (fresh.size || gone.size) this.unlocked = this.unlocked.filter((r) => !gone.has(r.key)).map((r) => fresh.get(r.key) ?? r);
    this.touched = words;
  }

  /** Every unlocked row, in the order of the reading rows. Keeps the rows it already has. */
  private unlockAll(): MemoryRow[] {
    const rows: MemoryRow[] = [];
    for (const g of this.groups.values()) {
      if (g.skill !== "read") continue;
      for (const skill of ["listen", "write"] as const) {
        const key = memKey(g.wordId, skill);
        const row = this.unlockedBy.get(key) ?? this.unlock(g.wordId, skill);
        if (!row) continue;
        this.unlockedBy.set(key, row);
        rows.push(row);
      }
    }
    return rows;
  }

  /** Harder skills unlock once reading is genuinely established, not after one lucky review. */
  private unlock(wordId: string, skill: Exclude<Skill, "read">): MemoryRow | null {
    const r = this.groups.get(memKey(wordId, "read"))?.row;
    if (!r || r.reps < 2 || r.s < UNLOCK[skill] || this.groups.has(memKey(wordId, skill))) return null;
    return { key: memKey(wordId, skill), wordId, skill, s: 0, d: 0, lastTs: r.lastTs, due: r.lastTs, reps: 0, lapses: 0 };
  }
}
