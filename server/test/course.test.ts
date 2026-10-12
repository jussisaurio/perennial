import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { COURSE_DEFAULTS as APP_DEFAULTS } from "../../web/src/data/rows.ts";
import { DECK_LANGS } from "../../web/src/deck/schema.ts";
import { COURSE_DEFAULTS, COURSE_LANGS, Lang } from "../src/course";

// The course languages are written down in three places that cannot share
// code at runtime: the API (src/course.ts), the app (DECK_LANGS) and decks/.
test("the API's course languages are the app's deck languages and the decks/ folders", () => {
  const decks = readdirSync(fileURLToPath(new URL("../../decks", import.meta.url)), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  expect([...COURSE_LANGS].sort()).toEqual([...DECK_LANGS].sort());
  expect([...Lang.options].sort()).toEqual([...DECK_LANGS].sort());
  expect(decks.sort()).toEqual([...DECK_LANGS].sort());
});

test("a new course gets the same defaults from the API and the app", () => {
  expect(COURSE_DEFAULTS).toEqual(APP_DEFAULTS);
});
