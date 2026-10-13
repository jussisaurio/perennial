import { describe, expect, test } from "bun:test";
import deckEs from "../../../decks/es/deck.json";
import deckDe from "../../../decks/de/deck.json";
import { Deck, GARDEN_WORDS } from "../deck/schema";
import { courseOrder, deckKind, introOrder, kindOf, nextWords, type WordKind } from "./order";

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

  test("garden words come 3rd, 12th, then every 27th, in garden order; the rest keep their pattern", () => {
    const pos = ["noun", "verb", "noun", "adj", "det"];
    const others = Array.from({ length: 60 }, (_, i) => ({ id: `w${i}`, pos: pos[i % 5], rank: i + 1 }));
    // Ranks and deck order say nothing: the garden list decides (cat, bird, dog, ...).
    const garden = [
      { id: "dog", pos: "noun", rank: 5, garden: "dog" as const },
      { id: "cat", pos: "noun", rank: 900, garden: "cat" as const },
      { id: "bird", pos: "noun", rank: 30, garden: "bird" as const },
    ];
    const order = courseOrder({ words: [...garden, ...others] }).map((w) => w.id);
    expect([order.indexOf("cat"), order.indexOf("bird"), order.indexOf("dog")]).toEqual([2, 11, 38]);
    expect(order.filter((id) => !["cat", "bird", "dog"].includes(id))).toEqual(introOrder(others, deckKind).map((w) => w.id));
  });

  test("a deck shorter than the garden slots keeps every word, garden words last", () => {
    const words = [
      { id: "n1", pos: "noun", rank: 1 },
      { id: "bird", pos: "noun", rank: 2, garden: "bird" as const },
      { id: "v1", pos: "verb", rank: 3 },
      { id: "cat", pos: "noun", rank: 4, garden: "cat" as const },
      { id: "n2", pos: "noun", rank: 5 },
    ];
    expect(courseOrder({ words }).map((w) => w.id)).toEqual(["n1", "v1", "cat", "n2", "bird"]);
  });

  for (const [lang, deck] of [["es", deckEs], ["de", deckDe]] as const) {
    const course = courseOrder({ words: Deck(lang).parse(deck).words.filter((w) => !w.retired && !w.aliasOf) });

    test(`${lang}: a new learner meets cat 3rd and bird 12th`, () => {
      const next = nextWords(course, () => true);
      expect(next).toEqual([...course]);
      expect([next[2].garden, next[11].garden]).toEqual(["cat", "bird"]);
    });

    test(`${lang}: a learner at course word 300 with no garden word yet gets one garden word, then 4 others, until caught up`, () => {
      const done = new Set(course.slice(0, 300).filter((w) => !w.garden).map((w) => w.id));
      const next = nextWords(course, (w) => !done.has(w.id));
      const behind = course.slice(0, 300).filter((w) => w.garden).length; // 12: places 3, 12, 39, … 282
      expect(behind).toBe(12);
      expect(next.slice(0, behind * 5).map((w) => !!w.garden)).toEqual(Array.from({ length: behind * 5 }, (_, i) => i % 5 === 0));
      // The garden words come in garden order; the others in course order, from word 301 on.
      expect(next.filter((w) => w.garden).slice(0, behind).map((w) => w.garden)).toEqual(GARDEN_WORDS.slice(0, behind));
      expect(next.filter((w) => !w.garden).slice(0, 10)).toEqual(course.slice(300).filter((w) => !w.garden).slice(0, 10));
    });

    test(`${lang}: every garden word is in the course once; cat comes 3rd and bird 12th`, () => {
      const words = Deck(lang).parse(deck).words.filter((w) => !w.retired && !w.aliasOf);
      expect(words.filter((w) => w.garden).map((w) => w.garden).sort()).toEqual([...GARDEN_WORDS].sort());
      const order = courseOrder({ words });
      expect([order[2].garden, order[11].garden]).toEqual(["cat", "bird"]);
    });
  }
});
