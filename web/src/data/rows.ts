// Rows as the server sends them from Postgres (GET /api/rows, see
// server/migrations): timestamps as ISO strings, numbers and JSON parsed.

import { Option, Schema } from "effect";

export const SKILLS = ["read", "listen", "write"] as const;
export type Skill = (typeof SKILLS)[number];

/** A new course's settings until the learner changes them (the server and the course table use the same). */
export const COURSE_DEFAULTS = { minutes: 7, retention: 0.9 } as const;

export interface CourseRow {
  user_id: string;
  lang: string;
  minutes: number;
  retention: number;
  /** The garden's door to the orchard (#315): opened with the key, and then open for good. */
  door_open: boolean;
  /** The gardener's notes the learner has read (#654), by id. The server only ever adds to it. */
  notes_read: readonly string[];
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
// so those rows come as a string. A migration fixes the stored rows, but this stays: during a
// deploy, the older server can still write string rows after the migration ran.
const decodeForms = Schema.decodeUnknownOption(Schema.Union([Forms, Schema.fromJsonString(Forms)]));

/**
 * A user_word row as the server sends it, with `forms` as a list. Forms of any
 * other shape are a bug: the word gets no forms of its own (the learner model
 * then uses the lemma), and `bad` hears the type that came, never the value.
 * A later edit of that word saves its forms as `[]`.
 */
export function syncedUserWord<R extends Record<string, unknown>>(row: R, bad: (type: string) => void): R {
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
