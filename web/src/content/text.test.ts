import { expect, test } from "bun:test";
import { coverage, findForm, locate, parseFrequencyList, tokenize } from "./text";

test("tokenize spaces and CJK", () => {
  expect(tokenize("¿Dónde está la casa?", "es").filter((t) => t.word).map((t) => t.text)).toEqual(["Dónde", "está", "la", "casa"]);
  expect(tokenize("私は猫が好きです", "ja").filter((t) => t.word).length).toBeGreaterThan(2);
});

test("frequency list + coverage", () => {
  const f = parseFrequencyList("de 50\nQue 30\nbad\ncasa 20\n");
  expect(f).toEqual([{ form: "de", count: 50 }, { form: "que", count: 30 }, { form: "casa", count: 20 }]);
  expect(coverage(f, new Set(["de", "que"]))).toBeCloseTo(0.8);
});

test("findForm", () => {
  expect(findForm("Mi Casa es tu casa.", ["casa"], "es")).toBe("Casa");
  expect(findForm("Lo casamos ayer", ["casa"], "es")).toBeNull();
  expect(findForm("私は猫が好き", ["猫"], "ja-JP")).toBe("猫");
  expect(findForm("Nada", ["casa"], "es")).toBeNull();
});

test("locate prefers whole words", () => {
  expect(locate("¿Dónde está de?", "de")).toBe(12);
  expect(locate("Dónde", "de")).toBe(3); // no whole-word match: first occurrence
  expect(locate("私は猫が好き", "猫")).toBe(2);
  expect(locate("abc", "")).toBe(-1);
});
