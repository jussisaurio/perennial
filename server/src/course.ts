// What a course is, for the API. MVP scope: English speakers learning Spanish
// or German. These must match the app (web/src/deck/schema.ts DECK_LANGS,
// web/src/data/rows.ts COURSE_DEFAULTS) and the decks/ folders, which
// test/course.test.ts checks, and the course table in migrations/0001_init.sql.

import { z } from "zod";

/** Course languages, with their English names for prompts. */
export const LANGUAGE = { es: "Spanish", de: "German" } as const;
export const COURSE_LANGS = Object.keys(LANGUAGE) as [keyof typeof LANGUAGE, ...(keyof typeof LANGUAGE)[]];
export const Lang = z.enum(COURSE_LANGS);

/** A new course's settings when the app sends none. */
export const COURSE_DEFAULTS = { minutes: 7, retention: 0.9 } as const;
