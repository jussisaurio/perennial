// Rows as they sync from Postgres (see server/migrations). Timestamps stay
// ISO strings; numbers and JSON are parsed by Electric.

import { Option, Schema } from "effect";
import type { GardenLeft } from "perennial-contract";

export type Skill = "read" | "listen" | "write";

/** A new course's settings until the learner changes them (the server and the course table use the same). */
export const COURSE_DEFAULTS = { minutes: 7, retention: 0.9 } as const;

export interface CourseRow {
  user_id: string;
  lang: string;
  minutes: number;
  retention: number;
  /** The garden's door to the orchard (#315): opened with the key, and then open for good. */
  door_open: boolean;
  /**
   * Leave it out (#351): what was left in the garden's bowl and when, and the
   * shed's shelf. Missing from course rows Electric streams before their first
   * course change after the migration.
   */
  garden_left?: GardenLeft;
  created_at: string;
}

export interface ReviewRow {
  id: string;
  user_id: string;
  lang: string;
  word_id: string;
  skill: Skill;
  grade: 1 | 2 | 3 | 4;
  kind: "review" | "known";
  reviewed_at: string;
  duration_ms: number;
  sentence_id: string | null;
}

export interface WordStateRow {
  user_id: string;
  word_id: string;
  status: "queued" | "paused" | "ignored";
  queued_at: string | null;
  updated_at: string;
}

export interface UserWordRow {
  id: string;
  user_id: string;
  lang: string;
  lemma: string;
  gloss: string;
  pos: string | null;
  forms: readonly string[];
  notes: string | null;
  deck_id: string | null;
  created_at: string;
}

const Forms = Schema.Array(Schema.String);
// /api/write once stored `forms` as a jsonb string holding the list's JSON text (#337),
// so those rows stream a string. A migration fixes the stored rows, but this stays: during a
// deploy, the older server can still write string rows after the migration ran.
const decodeForms = Schema.decodeUnknownOption(Schema.Union([Forms, Schema.fromJsonString(Forms)]));

/**
 * A user_word row as Electric streams it, with `forms` as a list. Forms of any
 * other shape are a bug: the word gets no forms of its own (the learner model
 * then uses the lemma), and `bad` hears the type that came, never the value.
 * A later edit of that word saves its forms as `[]`.
 */
export function syncedUserWord<R extends Record<string, unknown>>(row: R, bad: (type: string) => void): R {
  // An update carries only the columns it changed.
  if (!("forms" in row)) return row;
  const forms = decodeForms(row.forms);
  if (Option.isSome(forms)) return { ...row, forms: forms.value };
  bad(typeof row.forms);
  return { ...row, forms: [] };
}

export interface UserSentenceRow {
  id: string;
  user_id: string;
  word_id: string;
  text: string;
  translation: string;
  cloze: string;
  origin: "own-text" | "ai";
  model: string | null;
  created_at: string;
}
