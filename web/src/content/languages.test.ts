import { expect, test } from "bun:test";
import { language, teachable } from "./languages";

test("a course in a language this build has no deck for is left out", () => {
  expect(teachable([{ lang: "es" }, { lang: "fr" }, { lang: "de" }])).toEqual([{ lang: "es" }, { lang: "de" }]);
});

test("language() knows the course languages and refuses any other code", () => {
  expect(language("de")).toMatchObject({ name: "German", tag: "de-DE" });
  expect(() => language("fr")).toThrow('no course language "fr"');
});
