import { describe, expect, test } from "bun:test";
import deckEs from "../../../decks/es/deck.json";
import deckDe from "../../../decks/de/deck.json";
import { Deck, GARDEN_WORDS, ORCHARD_WORDS, type GardenWord, type OrchardWord } from "../deck/schema";
import { courseOrder, deckKind, gardenSlot, introOrder, kindOf, nextWords, notStartedWords, orchardSlot, placed, sincePlaced, type WordKind } from "./order";

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

  test("garden places: 3rd, 12th, then gaps that start at 27 words and shrink by 2 to a floor of 12", () => {
    const places = Array.from({ length: GARDEN_WORDS.length }, (_, n) => gardenSlot(n) + 1);
    expect(places.slice(0, 6)).toEqual([3, 12, 39, 64, 87, 108]);
    const gaps = places.slice(2).map((p, i) => p - places[i + 1]);
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBe(Math.max(12, gaps[i - 1] - 2));
    expect(gaps.at(-1)).toBe(12);
  });

  test("garden words come at their places, in garden order; the rest keep their pattern", () => {
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

  test("orchard places: the 70th, a few words after the key (64th), then one every 48; never within 5 of a garden place", () => {
    const places = ORCHARD_WORDS.map((_, n) => orchardSlot(n) + 1);
    expect(places.slice(0, 3)).toEqual([70, 118, 166]);
    expect(places.at(-1)).toBe(550);
    expect(gardenSlot(GARDEN_WORDS.indexOf("key")) + 1).toBe(64);
    // Closer than 5 would make nextWords hold one back (CATCH_UP), so a new learner would not get the course as it is.
    const garden = GARDEN_WORDS.map((_, n) => gardenSlot(n) + 1);
    for (const p of places) expect(Math.min(...garden.map((g) => Math.abs(g - p)))).toBeGreaterThanOrEqual(6);
  });

  test("orchard words come at their places, in orchard order, between the garden words", () => {
    const pos = ["noun", "verb", "noun", "adj", "det"];
    const others = Array.from({ length: 200 }, (_, i) => ({ id: `w${i}`, pos: pos[i % 5], rank: i + 1 }));
    // Ranks say nothing: the orchard list decides (tree, apple, ...).
    const orchard = [
      { id: "apple", pos: "noun", rank: 2, orchard: "apple" as const },
      { id: "tree", pos: "noun", rank: 900, orchard: "tree" as const },
    ];
    const garden = [{ id: "cat", pos: "noun", rank: 50, garden: "cat" as const }];
    const order = courseOrder({ words: [...orchard, ...garden, ...others] }).map((w) => w.id);
    expect([order.indexOf("cat"), order.indexOf("tree"), order.indexOf("apple")]).toEqual([2, 69, 117]);
    expect(order.filter((id) => !["cat", "tree", "apple"].includes(id))).toEqual(introOrder(others, deckKind).map((w) => w.id));
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
    // Orchard words that don't reach their places come after the garden words.
    const tree = { id: "tree", pos: "noun", rank: 0, orchard: "tree" as const };
    expect(courseOrder({ words: [tree, ...words] }).map((w) => w.id)).toEqual(["n1", "v1", "cat", "n2", "bird", "tree"]);
  });

  test("sincePlaced: other new words since the last garden or orchard word", () => {
    expect(sincePlaced([{ first: 1 }, { first: 2 }])).toBe(Infinity);
    expect(sincePlaced([{ garden: "cat", first: 1 }, { first: 2 }, { first: 3 }, { orchard: "tree", first: 4 }, { first: 5 }])).toBe(1);
  });

  for (const [lang, deck] of [["es", deckEs], ["de", deckDe]] as const) {
    const course = courseOrder({ words: Deck(lang).parse(deck).words.filter((w) => !w.retired && !w.aliasOf) });

    test(`${lang}: a new learner meets cat 3rd and bird 12th`, () => {
      const next = nextWords(course, () => true, sincePlaced([]));
      expect(next).toEqual([...course]);
      expect([next[2].garden, next[11].garden]).toEqual(["cat", "bird"]);
    });

    test(`${lang}: a learner at course word 300 with no garden or orchard word yet gets one of them, then 4 others, until caught up`, () => {
      const done = new Set(course.slice(0, 300).filter((w) => !placed(w)).map((w) => w.id));
      const next = nextWords(course, (w) => !done.has(w.id), sincePlaced([...done].map((_, i) => ({ first: i }))));
      const behind = course.slice(0, 300).filter(placed);
      expect(behind.filter((w) => w.garden).length).toBe(20); // places 3, 12, 39, … 292
      expect(behind.filter((w) => w.orchard).length).toBe(5); // places 70, 118, … 262
      expect(next.slice(0, behind.length * 5).map(placed)).toEqual(Array.from({ length: behind.length * 5 }, (_, i) => i % 5 === 0));
      // They come in course order, garden and orchard words mixed as placed; the others in course order, from word 301 on.
      expect(next.filter(placed).slice(0, behind.length)).toEqual(behind);
      expect(next.filter((w) => !placed(w)).slice(0, 10)).toEqual(course.slice(300).filter((w) => !placed(w)).slice(0, 10));
    });

    // A review backlog gives sessions only 1 or 2 new words (core/session.ts plan), and each
    // session works its new words out again, as learner.ts fresh() does, from the review history.
    for (const newCount of [1, 2]) {
      test(`${lang}: sessions of ${newCount} new word(s) keep the spacing: a garden or orchard word only after 4 other new words`, () => {
        const started = new Map<string, { garden?: GardenWord; orchard?: OrchardWord; first: number }>();
        for (const w of course.slice(0, 300)) if (!placed(w)) started.set(w.id, { first: started.size });
        const met: boolean[] = [];
        while (met.length < 60) {
          for (const w of nextWords(course, (x) => !started.has(x.id), sincePlaced(started.values())).slice(0, newCount)) {
            started.set(w.id, { garden: w.garden, orchard: w.orchard, first: started.size });
            met.push(placed(w));
          }
        }
        expect(met.slice(0, 60)).toEqual(Array.from({ length: 60 }, (_, i) => i % 5 === 0));
      });
    }

    test(`${lang}: the Words list's New starts with exactly what sessions bring next, for a learner past garden places`, () => {
      type W = (typeof course)[number] & { source: "deck"; status: string };
      const words = new Map<string, W>(course.map((w) => [w.id, { ...w, source: "deck", status: "active" }]));
      // 300 other words practised, no garden or orchard word yet; one upcoming word is paused.
      const practised = course.slice(0, 300).filter((w) => !placed(w));
      const done = new Set(practised.map((w) => w.id));
      const memories = practised.map((w) => ({ wordId: w.id, reps: 1 }));
      const paused = course[310].id;
      const upcoming = () => nextWords(course, (w) => !done.has(w.id) && w.id !== paused, sincePlaced(practised.map((_, i) => ({ first: i })))).map((w) => words.get(w.id)!);

      const ids = notStartedWords({ deck: { words: course }, words, memories, upcoming }).map((w) => w.id);
      const next = upcoming().map((w) => w.id);
      expect(next.length).toBeGreaterThan(500); // more than the old cap of 500: none are left out (#262)
      expect(ids.slice(0, next.length)).toEqual(next);
      expect(ids.slice(next.length)).toEqual([paused]); // paused words come after, never in between
      expect(words.get(ids[0])!.garden).toBe("cat"); // the first garden word they passed
    });

    test(`${lang}: every garden word is in the course once; cat comes 3rd and bird 12th`, () => {
      const words = Deck(lang).parse(deck).words.filter((w) => !w.retired && !w.aliasOf);
      expect(words.filter((w) => w.garden).map((w) => w.garden).sort()).toEqual([...GARDEN_WORDS].sort());
      const order = courseOrder({ words });
      expect([order[2].garden, order[11].garden]).toEqual(["cat", "bird"]);
      // The shrinking gaps (#236), in the real course: the key, 4th, at 64 (#315), then the sun at 87, the snail at 208, the ant at 364.
      const at = (g: GardenWord) => order.findIndex((w) => w.garden === g) + 1;
      expect([at("key"), at("sun"), at("snail"), at("ant")]).toEqual([64, 87, 208, 364]);
    });

    test(`${lang}: every orchard word is in the course once; the tree comes 70th, soon after the key`, () => {
      const words = Deck(lang).parse(deck).words.filter((w) => !w.retired && !w.aliasOf);
      expect(words.filter((w) => w.orchard).map((w) => w.orchard).sort()).toEqual([...ORCHARD_WORDS].sort());
      const order = courseOrder({ words });
      const at = (o: OrchardWord) => order.findIndex((w) => w.orchard === o) + 1;
      expect(ORCHARD_WORDS.map(at)).toEqual([70, 118, 166, 214, 262, 310, 358, 406, 454, 502, 550]);
    });

    // Never break progress: the key and the orchard words came to a course people were already
    // learning. `before` stands in for that course: this one with no key and no orchard words placed.
    // The new fruit words, last by rank, shift its kinds' turns from about word 800 on, so test learners before that.
    const before = courseOrder({ words: course.map((w) => ({ ...w, garden: w.garden === "key" ? undefined : w.garden, orchard: undefined })) });

    test(`${lang}: the course is unchanged before the key's place, so a learner there sees no difference`, () => {
      expect(course.slice(0, 63).map((w) => w.id)).toEqual(before.slice(0, 63).map((w) => w.id));
      expect(course[63].garden).toBe("key");
    });

    for (const at of [80, 150, 700]) {
      test(`${lang}: a learner at word ${at} of the course before keeps every started word; what they passed comes one in every 5 new words`, () => {
        const started = new Map(before.slice(0, at).map((w, i) => [w.id, { garden: w.garden, first: i }]));
        const next = nextWords(course, (w) => !started.has(w.id), sincePlaced(started.values()));
        // Nothing they started comes again, and every word they haven't started still comes, once.
        expect(next.filter((w) => started.has(w.id))).toEqual([]);
        expect(next.map((w) => w.id).sort()).toEqual(course.filter((w) => !started.has(w.id)).map((w) => w.id).sort());
        // The key and the trees whose places they passed come first, spaced out.
        const passed = course.slice(0, course.findIndex((w) => !started.has(w.id) && !placed(w))).filter((w) => !started.has(w.id));
        expect(passed.length).toBeGreaterThan(0);
        expect(next.filter(placed).slice(0, passed.length)).toEqual(passed);
        expect(next.slice(0, passed.length * 5).map(placed)).toEqual(Array.from({ length: passed.length * 5 }, (_, i) => i % 5 === 0));
      });
    }
  }
});
