import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import deckEs from "../../../decks/es/deck.json";
import deckDe from "../../../decks/de/deck.json";
import { Deck } from "../deck/schema";
import { HILL_NOTE } from "../garden/lookout";
import { courseNotes } from "../garden/notes/read";
import { storyJumps } from "./jumps";
import { planDemo } from "./plan";

const NOW = new Date("2026-11-07T12:00:00Z").getTime();

for (const [lang, deck] of [["es", deckEs], ["de", deckDe]] as const) {
  describe(`${lang} story points`, () => {
    // The live words in rank order, as the app loads them (data/deck.ts).
    const words = Schema.decodeUnknownSync(Deck(lang))(deck)
      .words.filter((w) => !w.retired && !w.aliasOf)
      .sort((a, b) => a.rank - b.rank);
    const jumps = storyJumps(lang, words.length);

    test("come from the notes and the visitors, in order", () => {
      const titles = jumps.map((j) => j.title);
      expect(titles).toContain("The stile stands");
      expect(titles).toContain("The way over the stile opens");
      expect(titles).toContain("The gnome moves in");
      expect(jumps.map((j) => j.known)).toEqual(jumps.map((j) => j.known).toSorted((a, b) => a - b));
    });

    // One word short misses the point's note; one word over may bring the next.
    test("the demo learner knows exactly the words of each point", () => {
      for (const { known } of jumps) expect(planDemo(words, { known }, NOW).filter((w) => w.known).length).toBe(known);
    });

    // Garden specs and screenshots use ?demo=es:800 to reach the lookout (docs/agents.md).
    if (lang === "es") {
      test("800 words studied open the way over the stile", () => {
        const hill = courseNotes(lang, words.length).find((n) => n.id === HILL_NOTE)!;
        expect(planDemo(words, { studied: 800 }, NOW).filter((w) => w.known).length).toBeGreaterThanOrEqual(hill.unlockAt);
      });
    }
  });
}
