// Rows as they sync from Postgres (see server/migrations). Timestamps stay
// ISO strings; numbers and JSON are parsed by Electric.

export type Skill = "read" | "listen" | "write";
export const SKILLS: Skill[] = ["read", "listen", "write"];

/** A new course's settings until the learner changes them (the server and the course table use the same). */
export const COURSE_DEFAULTS = { minutes: 7, retention: 0.9 } as const;

export interface CourseRow {
  user_id: string;
  lang: string;
  minutes: number;
  retention: number;
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
  forms: string[];
  notes: string | null;
  deck_id: string | null;
  created_at: string;
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
