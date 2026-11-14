import { expect, test } from "bun:test";
import type { SourceWord } from "../../web/src/deck/schema.ts";
import { echoes, nearest, wornOpenings } from "./draft.ts";

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

// Older sentences that share little with the new ones, so the deck's common words weigh little.
const filler = [
  word("ver", ["No veo nada desde aquí.", "veo"], ["¿Ves el mar?", "Ves"]),
  word("casa", ["Mi casa es tu casa.", "casa"], ["La casa está lejos.", "casa"]),
  word("comer", ["¿Qué quieres comer?", "comer"], ["Comemos a las dos.", "Comemos"]),
  word("llover", ["Mañana va a llover.", "llover"], ["Llueve mucho en el norte.", "Llueve"]),
];

test("near: an older sentence that fills my blank with its own word ranks first, though its card blanks another word", () => {
  const calor = word("calor", ["No soporto el calor.", "calor"]);
  const mine = word("aguantar", ["No aguanto el calor.", "aguanto"]);
  const [first] = nearest([mine], [...filler, calor, mine]);
  expect(first).toMatchObject({ by: "frame", lemma: "aguantar", sentence: 1, other: { lemma: "calor", text: "No soporto el calor." } });
  expect(first!.score).toBeCloseTo(1);
});

test("near: an older word's sentence with the same English ranks first", () => {
  const said = (w: SourceWord, translation: string): SourceWord => ({ ...w, sentences: w.sentences.map((s) => ({ ...s, translation })) });
  const older = said(word("desgracia", ["Fue una desgracia para la familia.", "desgracia"]), "It was a tragedy for the whole family.");
  const mine = said(word("drama", ["Aquello fue un drama.", "drama"]), "It was a tragedy for the whole family.");
  const [first] = nearest([mine], [...filler, older, mine]);
  expect(first).toMatchObject({ by: "english", other: { lemma: "desgracia" } });
  expect(first!.score).toBeCloseTo(1);
});

test("near: a word that is not next to my blank is not taken as its filler", () => {
  const older = word("mirar", ["Nadie me miró.", "miró"]);
  const mine = word("confundido", ["Me miró confundida.", "confundida"]);
  const swap = word("triste", ["Me miró triste.", "triste"]);
  const scores = nearest([mine], [...filler, older, swap, mine]).filter((n) => n.by === "frame");
  expect(scores.map((n) => n.other.lemma)).toEqual(["triste", "mirar"]);
  expect(scores[0]!.score).toBeCloseTo(1);
  expect(scores[1]!.score).toBeLessThan(0.9);
});
