import { describe, expect, test } from "bun:test";
import deckEs from "../../../decks/es/deck.json";
import deckDe from "../../../decks/de/deck.json";
import latinEs from "../../../decks/es/latin.json";
import latinDe from "../../../decks/de/latin.json";

// Latin names (#212): flavour text for the field guide, "<Word> <epithet>".
// German keeps the lemma's own case, because a capital makes another word
// (weg "away", Weg "path"). In Spanish a capital never does, so the genus
// gets one, like a botanical name.
const capitalise = (lemma: string) => lemma[0].toUpperCase() + lemma.slice(1);
const decks = [
  ["es", deckEs, latinEs, capitalise],
  ["de", deckDe, latinDe, (lemma: string) => lemma],
] as const;

describe("Latin names", () => {
  for (const [lang, deck, latin, genusOf] of decks) {
    const names = Object.entries(latin as Record<string, string>);
    const deckKeys = new Set((deck.words as { lemma: string; pos: string }[]).map((w) => `${w.lemma}|${w.pos}`));

    test(`${lang}: every name is for a word in the deck`, () => {
      expect(names.map(([k]) => k).filter((k) => !deckKeys.has(k))).toEqual([]);
    });

    test(`${lang}: every name is "<Word> <epithet>", the genus is the word itself`, () => {
      for (const [key, name] of names) {
        expect(name).toMatch(/^\p{L}[\p{L}\-']* [a-z]{4,14}$/u);
        expect(name.split(" ")[0]).toBe(genusOf(key.split("|")[0]));
      }
    });

    test(`${lang}: no epithet is used more than 3 times`, () => {
      const counts = new Map<string, number>();
      for (const [, name] of names) {
        const epithet = name.split(" ")[1];
        counts.set(epithet, (counts.get(epithet) ?? 0) + 1);
      }
      expect([...counts].filter(([, n]) => n > 3)).toEqual([]);
    });
  }
});
