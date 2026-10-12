import { describe, expect, test } from "bun:test";
import deckEs from "../../../decks/es/deck.json";
import deckDe from "../../../decks/de/deck.json";
import { courseOrder, deckKind, introOrder, kindOf, type WordKind } from "./order";

const kind = (s: string): WordKind => ({ n: "noun", v: "verb", o: "other", f: "function" })[s[0] as "n" | "v" | "o" | "f"] as WordKind;

describe("introOrder", () => {
  test("kinds take turns: noun, verb, noun, other, function; each kind keeps its order", () => {
    expect(introOrder(["f1", "o1", "v1", "n1", "f2", "n2", "v2", "n3", "o2", "n4"], kind)).toEqual(["n1", "v1", "n2", "o1", "f1", "n3", "v2", "n4", "o2", "f2"]);
  });
  test("a kind that runs out gives its turn to the next", () => {
    expect(introOrder(["f1", "f2", "f3", "n1"], kind)).toEqual(["n1", "f1", "f2", "f3"]);
    expect(introOrder(["v1", "v2", "v3"], kind)).toEqual(["v1", "v2", "v3"]);
    expect(introOrder([], kind)).toEqual([]);
  });
  test("keeps every item exactly once", () => {
    const items = Array.from({ length: 60 }, (_, i) => `${"nvof"[i % 4]}${i}`);
    expect(introOrder(items, kind).sort()).toEqual([...items].sort());
  });
  test("parts of speech map to kinds", () => {
    expect(["noun", "verb", "adj", "adv", "num", "pron", "det", "prep", "conj", "particle", "interj"].map(kindOf)).toEqual(["noun", "verb", "other", "other", "other", "function", "function", "function", "function", "function", "function"]);
  });
});

describe("the real decks", () => {
  for (const [lang, deck] of [["es", deckEs], ["de", deckDe]] as const) {
    test(`${lang}: the first 20 new words are mostly nouns and verbs, at most 4 grammar words`, () => {
      const words = (deck.words as { pos: string; rank: number; retired?: boolean }[]).filter((w) => !w.retired).sort((a, b) => a.rank - b.rank);
      const first = introOrder(words, deckKind).slice(0, 20);
      expect(first.filter((w) => w.pos === "noun").length).toBeGreaterThanOrEqual(8);
      expect(first.filter((w) => w.pos === "verb").length).toBeGreaterThanOrEqual(4);
      expect(first.filter((w) => deckKind(w) === "function").length).toBeLessThanOrEqual(4);
    });
  }
});

describe("courseOrder", () => {
  test("one answer per deck: frequency order within kinds, worked out once", () => {
    const deck = { words: [{ id: "c", pos: "noun", rank: 3 }, { id: "a", pos: "det", rank: 1 }, { id: "b", pos: "noun", rank: 2 }, { id: "d", pos: "verb", rank: 4 }] };
    const order = courseOrder(deck);
    expect(order.map((w) => w.id)).toEqual(["b", "d", "c", "a"]);
    expect(courseOrder(deck)).toBe(order); // memoized for this deck
  });
});
