import { expect, test } from "bun:test";
import type { Learner, Word } from "./learner";
import { grownSpans } from "./reading";

// A learner whose words are these, with a reading memory for the grown ones.
function learner(words: (Pick<Word, "id" | "lemma" | "pos" | "forms"> & { grown?: boolean })[]): Learner {
  return {
    words: new Map(words.map((w) => [w.id, w])),
    memory: new Map(words.filter((w) => w.grown).map((w) => [`${w.id}:read`, { reps: 2 }])),
  } as unknown as Learner;
}
const shown = (text: string, spans: [number, number][]) => spans.map(([s, e]) => text.slice(s, e));

test("grown words in a sentence: content words the learner has practised, not grammar words or the card's own word", () => {
  const l = learner([
    { id: "gato", lemma: "gato", pos: "noun", forms: ["gato", "gatos"], grown: true },
    { id: "comer", lemma: "comer", pos: "verb", forms: ["comer", "come"], grown: true },
    { id: "el", lemma: "el", pos: "det", forms: ["el"], grown: true }, // grammar: lights up every sentence
    { id: "pescado", lemma: "pescado", pos: "noun", forms: ["pescado"] }, // not practised yet
  ]);
  const text = "El gato come pescado. Los gatos comen.";
  expect(shown(text, grownSpans(l, text, "es", "pescado"))).toEqual(["gato", "come", "gatos"]);
  // The word the card asks about is never tinted, whichever form it takes.
  expect(shown(text, grownSpans(l, text, "es", "gato"))).toEqual(["come"]);
});
