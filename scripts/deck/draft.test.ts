import { expect, test } from "bun:test";
import type { SourceWord } from "../../web/src/deck/schema.ts";
import { echoes, wornOpenings } from "./draft.ts";

const word = (lemma: string, ...texts: [string, string][]): SourceWord => ({
  lemma,
  gloss: lemma,
  pos: "verb",
  forms: texts.map(([, cloze]) => cloze),
  sentences: texts.map(([text, cloze]) => ({ text, translation: "-", cloze })),
});

test("a synonym in an older sentence's slot is a same-frame echo: the learner would answer the older word", () => {
  const older = word("odiar", ["Odio el calor.", "Odio"]);
  const mine = word("detestar", ["Detesto el calor.", "Detesto"]);
  expect(echoes([mine], [older, mine])).toEqual(['same-frame detestar: "Detesto el calor." ~ odiar: "Odio el calor."']);
});

test("an older sentence with one word changed is a near-duplicate", () => {
  const older = word("soportar", ["No soporto el calor de la tarde.", "soporto"]);
  const mine = word("aguantar", ["No aguanto el calor de la tarde.", "aguanto"]);
  expect(echoes([mine], [older, mine])).toEqual(['near-duplicate aguantar: "No aguanto el calor de la tarde." ~ soportar: "No soporto el calor de la tarde."']);
});

test("sentences that share only common words are not echoes", () => {
  const older = word("ver", ["No veo nada desde aquí.", "veo"]);
  const mine = word("aguantar", ["Ya no aguanto más este ruido.", "aguanto"]);
  expect(echoes([mine], [older, mine])).toEqual([]);
});

test("a word's own sentences never echo each other", () => {
  const mine = word("aguantar", ["No aguanto el calor.", "aguanto"], ["No aguantamos el calor.", "aguantamos"]);
  expect(echoes([mine], [mine])).toEqual([]);
});

test("worn openings count first three words with the target word as X", () => {
  const words = ["perro", "gato", "libro", "coche"].map((n) => word(n, [`Es un ${n} muy bonito.`, n]));
  expect(wornOpenings(words)).toEqual([["es un X", 4]]);
  expect(wornOpenings(words.slice(0, 3))).toEqual([]);
});
