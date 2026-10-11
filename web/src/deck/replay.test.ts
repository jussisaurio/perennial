// Replay: reviews written against one deck version still land on a word in
// the next version, whatever was retired, aliased or added in between.

import { expect, test } from "bun:test";
import { resolveWordId } from "./resolve";
import { compatibility, deckProblems, type Deck, type DeckSentence, type DeckWord } from "./schema";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const body = (n: number) => n.toString(32).padStart(10, "0").replace(/[0-9a-v]/g, (c) => ALPHABET[parseInt(c, 32)]);

function word(n: number): DeckWord {
  return { id: `es.w.${body(n)}`, lemma: `palabra${n}`, gloss: `word ${n}`, pos: "noun", rank: n + 1, forms: [`palabra${n}`] };
}
function sentencesOf(w: DeckWord, retired = false): DeckSentence[] {
  return [0, 1, 2].map((i) => ({
    id: `es.s.${w.id.slice(6)}${i}`,
    wordId: w.id,
    text: `Veo la ${w.lemma} ${i}.`,
    translation: `I see the ${w.gloss}.`,
    cloze: w.lemma,
    ...(retired ? { retired } : {}),
  }));
}

const v1Words = Array.from({ length: 40 }, (_, i) => word(i));
const v1: Deck = { lang: "es", native: "en", version: 1, words: v1Words, sentences: v1Words.flatMap((w) => sentencesOf(w)) };

// v2: words 3 and 7 retired, 12 is a duplicate of 2, and five new words.
const retiredIds = new Set([v1Words[3].id, v1Words[7].id]);
const dup = v1Words[12];
const added = Array.from({ length: 5 }, (_, i) => word(100 + i));
const v2Words = [
  ...v1Words.map((w) => (retiredIds.has(w.id) ? { ...w, retired: true } : w === dup ? { ...w, retired: true, aliasOf: v1Words[2].id } : w)),
  ...added,
];
const v2: Deck = {
  lang: "es",
  native: "en",
  version: 2,
  words: v2Words,
  sentences: v2Words.flatMap((w) => sentencesOf(w, !!w.retired)),
};

// A synthetic log: a few reviews of every v1 word, ids only, as in Postgres.
const log = v1Words.flatMap((w, i) => Array.from({ length: 1 + (i % 4) }, (_, k) => ({ id: `r${i}-${k}`, word_id: w.id, grade: 1 + ((i + k) % 4) })));

test("v2 is a valid, compatible successor of v1", () => {
  expect(deckProblems(v1)).toEqual([]);
  expect(deckProblems(v2)).toEqual([]);
  const c = compatibility(v1, v2);
  expect(c.errors).toEqual([]);
  expect([c.added, c.retired]).toEqual([5, 2]); // the alias is not counted as retired
});

test("every review from v1 resolves in v2: nothing is orphaned", () => {
  const orphans = log.filter((r) => !resolveWordId(v2, r.word_id));
  expect(orphans).toEqual([]);

  // Progress per resolved word: the duplicate's reviews join its target's.
  const perWord = new Map<string, number>();
  for (const r of log) {
    const w = resolveWordId(v2, r.word_id)!;
    perWord.set(w.id, (perWord.get(w.id) ?? 0) + 1);
  }
  const count = (id: string) => log.filter((r) => r.word_id === id).length;
  expect(perWord.get(v1Words[2].id)).toBe(count(v1Words[2].id) + count(dup.id));
  expect(perWord.has(dup.id)).toBe(false);
  expect([...perWord.values()].reduce((a, b) => a + b)).toBe(log.length);
});

test("resolveWordId", () => {
  expect(resolveWordId(v2, v1Words[0].id)).toBe(v2.words[0]);
  // Retired words still resolve, so their reviews stay (hidden).
  expect(resolveWordId(v2, v1Words[3].id)?.retired).toBe(true);
  // An alias resolves to its target, one hop.
  expect(resolveWordId(v2, dup.id)?.id).toBe(v1Words[2].id);
  // Unknown ids (e.g. from a newer deck) resolve to nothing; the caller keeps them hidden.
  expect(resolveWordId(v1, added[0].id)).toBeUndefined();
  expect(resolveWordId(v2, "user-word-uuid")).toBeUndefined();
  // A dangling alias (invalid deck) falls back to the word itself instead of crashing.
  const broken: Deck = { ...v1, words: [{ ...v1Words[0], aliasOf: "es.w.zzzzzzzzzz" }] };
  expect(resolveWordId(broken, v1Words[0].id)?.id).toBe(v1Words[0].id);
});
