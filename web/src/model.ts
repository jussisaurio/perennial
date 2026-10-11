import type { Grade } from "./core/fsrs";

export type Skill = "read" | "listen" | "write";
export const SKILLS: Skill[] = ["read", "listen", "write"];

/** Fields shared by every synced row. `_ts` holds the HLC stamp of each field's last write. */
export interface Synced {
  id: string;
  _ts?: Record<string, string>;
  deleted?: number;
}

export interface Course extends Synced {
  lang: string; // FrequencyWords code, e.g. "es", "pt_br"
  native: string; // English name of the learner's language, e.g. "English"
  minutes: number;
  retention: number;
  createdAt: number;
  /** How far into the frequency list content has been generated. */
  freqCursor?: number;
}

export interface Lexeme extends Synced {
  courseId: string;
  lemma: string;
  gloss: string;
  pos?: string;
  rank?: number; // frequency rank of the lemma's most common form
  forms: string[]; // surface forms seen in text, lowercase
  notes?: string;
  addedAt: number;
  /** Words the learner picked themselves are introduced before frequency-list words. */
  picked?: number;
  status?: "active" | "suspended" | "ignored";
}

export interface Example extends Synced {
  courseId: string;
  lexemeId: string;
  text: string;
  translation: string;
  cloze: string; // the exact substring of `text` that realizes the lexeme
  source: "llm" | "mined" | "manual" | "import";
  createdAt: number;
  /** Who wrote it, for AI-written sentences: where the model ran and its name. */
  origin?: "hosted" | "own" | "local";
  model?: string;
}

/**
 * The review log is the source of truth for all scheduling. Reviews are never
 * edited; the only change allowed is a tombstone (`deleted`) from Undo.
 */
export interface Review {
  id: string;
  deleted?: number;
  courseId: string;
  lexemeId: string;
  skill: Skill;
  grade: Grade;
  ts: number;
  ms: number; // time spent
  exampleId?: string;
}

/** Derived from reviews; local only, never synced. `reps === 0` means unlocked but not yet practised. */
export interface MemoryRow {
  key: string; // `${lexemeId}:${skill}`
  courseId: string;
  lexemeId: string;
  skill: Skill;
  s: number;
  d: number;
  lastTs: number;
  due: number;
  reps: number;
  lapses: number;
}

export const memKey = (lexemeId: string, skill: Skill) => `${lexemeId}:${skill}`;
