import { expect, test } from "bun:test";
import { locate, tokenize } from "./text";

test("tokenize spaces and CJK", () => {
  expect(tokenize("¿Dónde está la casa?", "es").filter((t) => t.word).map((t) => t.text)).toEqual(["Dónde", "está", "la", "casa"]);
  expect(tokenize("私は猫が好きです", "ja").filter((t) => t.word).length).toBeGreaterThan(2);
});

test("locate prefers whole words", () => {
  expect(locate("¿Dónde está de?", "de")).toBe(12);
  expect(locate("Dónde", "de")).toBe(3); // no whole-word match: first occurrence
  expect(locate("私は猫が好き", "猫")).toBe(2);
  expect(locate("abc", "")).toBe(-1);
});
