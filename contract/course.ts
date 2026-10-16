// What a course is, on the wire. MVP scope: English speakers learning Spanish
// or German. These must match the app (web/src/deck/schema.ts DECK_LANGS) and
// the decks/ folders, which server/test/course.test.ts checks, and the course
// table in server/migrations/0001_init.sql.

import { Schema } from "effect";

export const COURSE_LANGS = ["es", "de"] as const;
export const Lang = Schema.Literals(COURSE_LANGS);
export type Lang = typeof Lang.Type;
