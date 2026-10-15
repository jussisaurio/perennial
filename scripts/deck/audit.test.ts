import { expect, test } from "bun:test";
import type { Deck } from "../../web/src/deck/schema.ts";
import { auditDeck } from "./audit.ts";

const word = (n: number, lemma: string, extra: { garden?: "hedgehog"; orchard?: "fig" } = {}) => ({ id: `es.w.000000000${n}`, lemma, gloss: lemma, pos: "noun" as const, rank: n, forms: [lemma], ...extra });
const sentences = (n: number, lemma: string) => [1, 2, 3].map((i) => ({ id: `es.s.00000000${n}${i}`, wordId: `es.w.000000000${n}`, text: `El ${lemma} ${i}.`, translation: `The ${lemma}.`, cloze: lemma }));

test("rank drift is flagged, except for garden and orchard words, which the course places on purpose", () => {
  const words = [word(1, "erizo", { garden: "hedgehog" }), word(2, "tortuga"), word(3, "higo", { orchard: "fig" })];
  const deck: Deck = { lang: "es", native: "en", version: 1, words, sentences: [...sentences(1, "erizo"), ...sentences(2, "tortuga"), ...sentences(3, "higo")] };
  const ranks = new Map([["erizo", 27_000], ["tortuga", 9_000], ["higo", 28_000], ["el", 1]]);
  const drift = auditDeck("es", deck, ranks).findings.filter((f) => f.code === "rank-drift");
  expect(drift.map((f) => f.lemma)).toEqual(["tortuga"]);
});
