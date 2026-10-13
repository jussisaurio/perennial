import { expect, test } from "bun:test";
import type { Deck } from "../../web/src/deck/schema.ts";
import { auditDeck } from "./audit.ts";

const word = (n: number, lemma: string, garden?: "hedgehog") => ({ id: `es.w.000000000${n}`, lemma, gloss: lemma, pos: "noun" as const, rank: n, forms: [lemma], ...(garden ? { garden } : {}) });
const sentences = (n: number, lemma: string) => [1, 2, 3].map((i) => ({ id: `es.s.00000000${n}${i}`, wordId: `es.w.000000000${n}`, text: `El ${lemma} ${i}.`, translation: `The ${lemma}.`, cloze: lemma }));

test("rank drift is flagged, except for garden words, which the course places early on purpose", () => {
  const deck: Deck = { lang: "es", native: "en", version: 1, words: [word(1, "erizo", "hedgehog"), word(2, "tortuga")], sentences: [...sentences(1, "erizo"), ...sentences(2, "tortuga")] };
  const ranks = new Map([["erizo", 27_000], ["tortuga", 9_000], ["el", 1]]);
  const drift = auditDeck("es", deck, ranks).findings.filter((f) => f.code === "rank-drift");
  expect(drift.map((f) => f.lemma)).toEqual(["tortuga"]);
});
