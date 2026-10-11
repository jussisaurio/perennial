import { expect, test } from "bun:test";
import { Deck, compatibility, deckProblems, manifestKey, type DeckWord } from "./schema";

const w = (body: string, lemma: string, extra: Partial<DeckWord> = {}): DeckWord => ({ id: `es.w.${body}`, lemma, gloss: lemma, pos: "noun", rank: 1, forms: [lemma], ...extra });
const sentences = (word: DeckWord, n = 3) =>
  Array.from({ length: n }, (_, i) => ({ id: `es.s.${word.id.slice(5, 14)}${i}`, wordId: word.id, text: `Mi ${word.lemma} ${i}.`, translation: `My ${word.lemma}.`, cloze: word.lemma }));
const deck = (words: DeckWord[], extra: Partial<Deck> = {}): Deck => ({
  lang: "es",
  native: "en",
  version: 1,
  words,
  sentences: words.filter((x) => !x.aliasOf).flatMap((x) => sentences(x)),
  ...extra,
});

const casa = w("casa000000", "casa");
const perro = w("perr000000", "perro");

test("a well-formed deck parses and has no problems", () => {
  const d = deck([casa, perro]);
  expect(Deck("es").safeParse(d).success).toBe(true);
  expect(deckProblems(d)).toEqual([]);
});

test("schema rejects bad ids and a wrong language", () => {
  expect(Deck("es").safeParse(deck([{ ...casa, id: "es.w.CASA" }])).success).toBe(false);
  expect(Deck("es").safeParse(deck([{ ...casa, id: "es.w.casa00000i" }])).success).toBe(false); // no i in the alphabet
  expect(Deck("de").safeParse(deck([casa])).success).toBe(false);
});

test("deckProblems finds broken invariants", () => {
  const d = deck([casa, perro]);
  expect(deckProblems({ ...d, words: [casa, casa, perro] })).toContain("duplicate word ids");
  expect(deckProblems({ ...d, sentences: [...d.sentences, d.sentences[0]] })[0]).toMatch(/duplicate sentence id/);
  expect(deckProblems({ ...d, sentences: d.sentences.map((s, i) => (i ? s : { ...s, cloze: "gato" })) })[0]).toMatch(/is not in/);
  expect(deckProblems({ ...d, sentences: d.sentences.map((s, i) => (i ? s : { ...s, cloze: s.text })) })[0]).toMatch(/whole sentence/);
  expect(deckProblems({ ...d, sentences: d.sentences.map((s, i) => (i ? s : { ...s, wordId: "es.w.zzzzzzzzzz" })) }).join()).toMatch(/unknown word/);
  // Retiring a sentence leaves casa with 2 live ones.
  expect(deckProblems({ ...d, sentences: d.sentences.map((s, i) => (i ? s : { ...s, retired: true })) })[0]).toMatch(/fewer than 3 live sentences/);
  // A retired word needs no live sentences.
  expect(deckProblems({ ...d, words: [{ ...casa, retired: true }, perro], sentences: d.sentences.map((s) => ({ ...s, retired: s.wordId === casa.id })) })).toEqual([]);
});

test("deckProblems checks aliases and duplicate lemmas", () => {
  const dup = w("casa111111", "casa");
  expect(deckProblems(deck([casa, dup]))[0]).toMatch(/share lemma/);
  expect(deckProblems(deck([casa, w("casa111111", "Casa", { sense: "home" })]))).toEqual([]);
  expect(deckProblems(deck([casa, { ...dup, aliasOf: casa.id }]))).toEqual([]);
  expect(deckProblems(deck([casa, { ...dup, aliasOf: "es.w.zzzzzzzzzz" }]))[0]).toMatch(/alias of unknown/);
  const chain = deck([casa, { ...perro, aliasOf: casa.id }, { ...dup, aliasOf: perro.id }]);
  expect(deckProblems(chain)[0]).toMatch(/alias of an alias/);
  const toRetired = deck([{ ...casa, retired: true }, { ...dup, aliasOf: casa.id }], { sentences: [] });
  expect(deckProblems(toRetired)[0]).toMatch(/alias of retired/);
});

test("manifestKey ignores case and Unicode normalization", () => {
  expect(manifestKey({ lemma: "Árbol", pos: "noun" })).toBe(manifestKey({ lemma: "árbol", pos: "noun" }));
  expect(manifestKey({ lemma: "banco", pos: "noun", sense: "bench" })).not.toBe(manifestKey({ lemma: "banco", pos: "noun" }));
});

test("compatibility: additions, edits and retirements are counted", () => {
  const prev = deck([casa, perro]);
  const gato = w("gat0000000", "gato");
  const next = deck([{ ...casa, gloss: "home" }, { ...perro, retired: true }, gato], { version: 2 });
  const c = compatibility(prev, next);
  expect(c.errors).toEqual([]);
  expect([c.added, c.edited, c.retired, c.retiredShare]).toEqual([1, 1, 1, 0.5]);
});

test("compatibility: removing, reusing or un-retiring ids is an error", () => {
  const prev = deck([casa, perro]);
  expect(compatibility(prev, deck([casa])).errors.join()).toMatch(/perro\) was removed/);
  expect(compatibility(prev, deck([casa, { ...perro, pos: "verb" }])).errors.join()).toMatch(/changed part of speech/);
  expect(compatibility(prev, { ...prev, version: 0 }).errors.join()).toMatch(/version went down/);
  const retired = deck([casa, { ...perro, retired: true }]);
  expect(compatibility(retired, prev).errors.join()).toMatch(/un-retired/);
  expect(compatibility(prev, { ...prev, sentences: prev.sentences.slice(1) }).errors.join()).toMatch(/sentence .* was removed/);
  const moved = prev.sentences.map((s, i) => (i ? s : { ...s, wordId: perro.id }));
  expect(compatibility(prev, { ...prev, sentences: moved }).errors.join()).toMatch(/moved to another word/);
  const sRetired = prev.sentences.map((s, i) => (i ? s : { ...s, retired: true }));
  expect(compatibility({ ...prev, sentences: sRetired }, prev).errors.join()).toMatch(/sentence .* was un-retired/);
});

test("compatibility: an alias is not a retirement, and is permanent", () => {
  const dup = w("casa111111", "casa");
  const prev = deck([casa, dup]);
  const merged = deck([casa, { ...dup, retired: true, aliasOf: casa.id }], { sentences: prev.sentences.map((s) => ({ ...s, retired: s.wordId === dup.id })) });
  const c = compatibility(prev, merged);
  expect(c.errors).toEqual([]);
  expect(c.retired).toBe(0);
  expect(compatibility(merged, { ...merged, words: [casa, { ...dup, retired: true }] }).errors.join()).toMatch(/changed alias/);
});
