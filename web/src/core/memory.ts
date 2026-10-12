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

export function recall(m: MemoryRow, now = Date.now()): number {
  return m.reps ? fsrs.retrievability((now - m.lastTs) / DAY_MS, m.s) : 0;
}

export const memKey = (wordId: string, skill: Skill) => `${wordId}:${skill}`;

/** A word's reading memory, which decides its state and its plant. */
export function readMemory<M>(l: { memory: { get: (key: string) => M | undefined } }, wordId: string): M | undefined {
  return l.memory.get(memKey(wordId, "read"));
}

/** Fold reviews into memory rows per word and skill, plus unlocked-but-unpractised skills. */
export function deriveMemory(reviews: ReviewRow[], retention: number, resolve: (id: string) => string): MemoryRow[] {
  const groups = new Map<string, { wordId: string; skill: Skill; list: { ts: number; grade: Grade }[] }>();
  for (const r of reviews) {
    const wordId = resolve(r.word_id);
    const key = memKey(wordId, r.skill);
    const g = groups.get(key) ?? { wordId, skill: r.skill, list: [] };
    g.list.push({ ts: Date.parse(r.reviewed_at), grade: r.grade });
    groups.set(key, g);
  }
  const rows: MemoryRow[] = [];
  const read = new Map<string, MemoryRow>();
  for (const [key, g] of groups) {
    const st = replay(fsrs, g.list, retention, key);
    if (!st) continue;
    const row: MemoryRow = { key, wordId: g.wordId, skill: g.skill, ...st };
    rows.push(row);
    if (g.skill === "read") read.set(g.wordId, row);
  }
  // Harder skills unlock once reading is genuinely established, not after one lucky review.
  for (const [wordId, r] of read) {
    if (r.reps < 2) continue;
    for (const skill of ["listen", "write"] as const) {
      if (r.s >= UNLOCK[skill] && !groups.has(memKey(wordId, skill))) {
        rows.push({ key: memKey(wordId, skill), wordId, skill, s: 0, d: 0, lastTs: r.lastTs, due: r.lastTs, reps: 0, lapses: 0 });
      }
    }
  }
  return rows;
}
