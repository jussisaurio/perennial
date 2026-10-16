// What a course is, for the server. The languages themselves are in the wire
// contract (contract/course.ts). COURSE_DEFAULTS must match the app
// (web/src/data/rows.ts), which test/course.test.ts checks, and the course
// table in migrations/0001_init.sql.

import type { Lang } from "perennial-contract";

/** The course languages' English names, for prompts. */
export const LANGUAGE: Record<Lang, string> = { es: "Spanish", de: "German" };

/** A new course's settings when the app sends none. */
export const COURSE_DEFAULTS = { minutes: 7, retention: 0.9 } as const;
