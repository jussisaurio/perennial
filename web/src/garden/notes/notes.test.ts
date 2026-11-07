import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import deckEs from "../../../../decks/es/deck.json";
import deckDe from "../../../../decks/de/deck.json";
import { courseOrder } from "../../content/order";
import { Deck } from "../../deck/schema";
import type { PerLang } from "../nouns";
import { NOTES } from ".";
import { noteInk } from "./read";

// The gardener's own words, which no deck teaches (#654). Every other word in a
// note is a deck lemma, or maps to one through `forms`.
const GARDENER_WORDS: PerLang<readonly string[]> = {
  es: ["puertecilla", "migas", "saltavallas", "lucero"],
  de: ["türchen", "krümel", "zauntreppe", "fünkchen"],
};

for (const [lang, deck] of [["es", deckEs], ["de", deckDe]] as const) {
  describe(`${lang} notes`, () => {
    const course = courseOrder({ words: Schema.decodeUnknownSync(Deck(lang))(deck).words.filter((w) => !w.retired && !w.aliasOf) });
    // A lemma is known once the learner knows this many course words: its place, counting from 1.
    const place = new Map<string, number>();
    course.forEach((w, i) => {
      const lemma = w.lemma.normalize("NFC").toLowerCase();
      if (!place.has(lemma)) place.set(lemma, i + 1);
    });
    const notes = NOTES[lang];
    const gardener = new Set(GARDENER_WORDS[lang]);
    /** The words of a note as the shed shows them, without the crossed-out one and the gardener's words. */
    // A lemma missing from the deck is never known, so the first test names it.
    const inkAt = (n: (typeof notes)[number], known: number) =>
      noteInk({ ...n, text: n.text.replace(/~~[^~]*~~/g, "") }, (lemma) => (place.get(lemma) ?? Infinity) <= known).filter((ink) => /\p{L}/u.test(ink.text) && !gardener.has(ink.text.toLowerCase()));

    test("every word is a deck word or one of 3-5 gardener words, and each gardener word comes back", () => {
      expect(notes.flatMap((n) => inkAt(n, Infinity).filter((ink) => ink.faint).map((ink) => ink.text))).toEqual([]);
      expect(gardener.size).toBeGreaterThanOrEqual(3);
      expect(gardener.size).toBeLessThanOrEqual(5);
      for (const g of gardener) expect(notes.filter((n) => n.text.toLowerCase().includes(g)).length).toBeGreaterThanOrEqual(2);
    });

    // At least 55% known, so no note is unreadable. The 75% ceiling is only for
    // the early and stile notes, where working words out is the point. Late
    // notes unlock after most common words, so a ceiling there forced rare
    // filler words into what should be the plainest notes.
    test("each note unlocks when the learner knows 55% of its words, and an early or stile note at most 75%", () => {
      for (const n of notes) {
        const ink = inkAt(n, n.unlockAt);
        const share = ink.filter((i) => !i.faint).length / ink.length;
        const ceiling = n.beat === "early" || n.beat === "stile" ? 0.75 : 1;
        expect({ id: n.id, ok: share >= 0.55 && share <= ceiling }).toEqual({ id: n.id, ok: true });
      }
    });

    test("notes come in story order, with one crossed-out word in an early note", () => {
      const beats = ["early", "stile", "lookout", "late", "door"];
      for (let i = 1; i < notes.length; i++) {
        expect(notes[i].unlockAt).toBeGreaterThan(notes[i - 1].unlockAt);
        expect(beats.indexOf(notes[i].beat)).toBeGreaterThanOrEqual(beats.indexOf(notes[i - 1].beat));
      }
      expect(notes.filter((n) => n.text.includes("~~")).map((n) => [n.beat, n.text.match(/~~[^~]+~~/g)?.length])).toEqual([["early", 1]]);
    });
  });
}
