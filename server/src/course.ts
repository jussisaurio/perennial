// What a course is, for the server. The languages themselves are in the wire
// contract (contract/course.ts). COURSE_DEFAULTS must match the app
// (web/src/data/rows.ts), which test/course.test.ts checks, and the course
// table in migrations/0001_init.sql.

import type { Lang } from "perennial-contract";

/** The course languages' English names, for prompts. */
export const LANGUAGE: Record<Lang, string> = { es: "Spanish", de: "German" };

/** A new course's settings when the app sends none. */
export const COURSE_DEFAULTS = { minutes: 7, retention: 0.9 } as const;

/**
 * A course row's notes read (#654) when two meet on conflict, as SQL: both
 * lists in one, each id once. The list only grows (sync.ts, auth.ts).
 */
export const NOTES_READ_UNION = "(select coalesce(jsonb_agg(distinct v order by v), '[]'::jsonb) from jsonb_array_elements(course.notes_read || excluded.notes_read) v)";
