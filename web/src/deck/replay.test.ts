// A deck version's successor: words retired, aliased or added in between, and
// still a valid, compatible deck.

import { expect, test } from "bun:test";
import { compatibility, deckProblems, ID_ALPHABET, type Deck, type DeckSentence, type DeckWord } from "./schema";

const body = (n: number) => n.toString(32).padStart(10, "0").replace(/[0-9a-v]/g, (c) => ID_ALPHABET[parseInt(c, 32)]);

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

test("v2 is a valid, compatible successor of v1", () => {
  expect(deckProblems(v1)).toEqual([]);
  expect(deckProblems(v2)).toEqual([]);
  const c = compatibility(v1, v2);
  expect(c.errors).toEqual([]);
  expect([c.added, c.retired]).toEqual([5, 2]); // the alias is not counted as retired
});
