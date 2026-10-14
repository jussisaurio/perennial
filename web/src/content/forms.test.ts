import { expect, test } from "bun:test";
import de from "../../../decks/de/deck.json";
import es from "../../../decks/es/deck.json";
import { askedForm, headword, otherForm } from "./forms";

const word = (deck: { words: { lemma: string; forms: string[] }[] }, lemma: string) => deck.words.find((w) => w.lemma === lemma)!;

test("the asked form loses only the capital the sentence gave it (#259)", () => {
  const ser = word(es, "ser");
  expect(askedForm(ser, { text: "Soy de Madrid.", cloze: "Soy" })).toBe("soy");
  expect(askedForm(ser, { text: "¿Eres tú?", cloze: "Eres" })).toBe("eres");
  // German nouns keep their capital, at the start of a sentence too.
  expect(askedForm(word(de, "Mann"), { text: "Männer arbeiten hier.", cloze: "Männer" })).toBe("Männer");
  // Formal Sie in the middle of a sentence is its own capital.
  expect(askedForm(word(de, "sie"), { text: "Können Sie mir helfen?", cloze: "Sie" })).toBe("Sie");
});

test("the answer names the dictionary word only when the asked form is another one (#259)", () => {
  const ich = word(de, "ich");
  expect(otherForm(ich, askedForm(ich, { text: "Gib mir das Buch.", cloze: "mir" }))).toBe("mir");
  expect(otherForm(ich, askedForm(ich, { text: "Ich bin müde.", cloze: "Ich" }))).toBeNull();
  expect(otherForm(word(de, "haben"), "hatten")).toBe("hatten");
});

test("German nouns come with der, die or das; other words as they are (#260)", () => {
  const head = (deck: typeof de | typeof es, lemma: string) => headword(deck.words.find((w) => w.lemma === lemma)!, deck.lang);
  expect([head(de, "Mann"), head(de, "Katze"), head(de, "Haus")]).toEqual(["der Mann", "die Katze", "das Haus"]);
  expect([head(de, "haben"), head(de, "Eltern"), head(es, "casa")]).toEqual(["haben", "Eltern", "casa"]);
});
