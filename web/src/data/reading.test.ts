import { expect, test } from "bun:test";
import type { Learner, Word } from "./learner";
import { grownSpans, readNow } from "./reading";

// A learner whose words are these, with a reading memory for the grown ones.
function learner(words: (Pick<Word, "id" | "lemma" | "pos" | "forms"> & { grown?: boolean })[], sentences: { id: string; text: string }[] = [], seen: string[] = []): Learner {
  return {
    deck: { sentencesByWord: new Map([["x", sentences.map((s) => ({ ...s, translation: `(${s.id})`, cloze: "" }))]]) },
    reviews: seen.map((id) => ({ sentence_id: id })),
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

test("a sentence to read now: every word grown, long enough, never on a card, about today's words", () => {
  const w = (lemma: string, pos: string, grown = true) => ({ id: lemma, lemma, pos, forms: [lemma], grown });
  const words = [w("el", "det"), w("gato", "noun"), w("come", "verb"), w("pan", "noun"), w("y", "conj"), w("bebe", "verb"), w("agua", "noun"), w("leche", "noun", false)];
  const sentences = [
    { id: "short", text: "El gato come." }, // too short to be news
    { id: "milk", text: "El gato come pan y bebe leche." }, // leche is not grown
    { id: "seen", text: "El gato come pan y bebe agua." }, // came on a card
    { id: "bread", text: "El gato bebe agua y come pan." },
    { id: "water", text: "Pan y agua, el gato come pan." },
  ];
  const l = learner(words, sentences, ["seen"]);
  expect(readNow(l, "es", new Set(), new Set())?.id).toBe("bread");
  expect(readNow(l, "es", new Set(), new Set(["bread"]))?.id).toBe("water"); // shown before
  expect(readNow(l, "es", new Set(["agua", "pan"]), new Set())?.id).toBe("water"); // more of today's words: pan twice
  expect(readNow(learner(words.slice(0, 3), sentences), "es", new Set(), new Set())).toBeNull();
});
