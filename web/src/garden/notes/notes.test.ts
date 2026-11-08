import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import deckEs from "../../../../decks/es/deck.json";
import deckDe from "../../../../decks/de/deck.json";
import { courseOrder } from "../../content/order";
import { Deck } from "../../deck/schema";
import { dayKnowing, onDay, type Trace } from "../../sim/trace";
import { nounLemma, type PerLang } from "../nouns";
import { SCENERY } from "../scenery";
import type { Note } from "./note";
import { courseNotes, noteInk } from "./read";

// The gardener's own words, which no deck teaches (#654). Every other word in a
// note is a deck lemma, or maps to one through `forms`.
const GARDENER_WORDS: PerLang<readonly string[]> = {
  es: ["puertecilla", "migas", "saltavallas", "zarzas", "lucero"],
  de: ["türchen", "krümel", "zauntreppe", "dornen", "fünkchen"],
};

// The simulated learner who does Today's 5 minutes every day (sim/traces). They learn a little out of course order
// and forget some, so they know fewer of a note's words than its count says (#938).
const DAILY: Record<"es" | "de", Trace> = {
  es: await Bun.file(new URL("../../sim/traces/es-daily.json", import.meta.url)).json(),
  de: await Bun.file(new URL("../../sim/traces/de-daily.json", import.meta.url)).json(),
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
    const notes = courseNotes(lang);
    const gardener = new Set(GARDENER_WORDS[lang]);
    // !: every scenery word has a word in each course (scenery.test.ts).
    const sceneryWords = new Set(Object.values(SCENERY).map((d) => nounLemma(d, lang)!.toLowerCase()));
    /** The words of a note as the shed shows them, without the crossed-out one and the gardener's words. */
    const ink = (n: Note, isKnown: (lemma: string) => boolean) =>
      noteInk({ ...n, text: n.text.replace(/~~[^~]*~~/g, "") }, isKnown).filter((i) => /\p{L}/u.test(i.text) && !gardener.has(i.text.toLowerCase()));
    const share = (words: ReturnType<typeof ink>) => words.filter((i) => i.style !== "faint").length / words.length;

    test("every word is a deck word, one of 3-5 gardener words, or a thing the garden names; each gardener word comes back", () => {
      // A word no deck teaches never shows clear (#937). The garden names some things the decks don't have: tap the
      // hedge and it says "el seto". The shed shows those faint, so the share below counts them as unknown.
      const faint = notes.flatMap((n) => ink(n, (lemma) => place.has(lemma)).filter((i) => i.style === "faint").map((i) => i.text.toLowerCase()));
      expect(faint.filter((w) => !sceneryWords.has(w))).toEqual([]);
      expect(gardener.size).toBeGreaterThanOrEqual(3);
      expect(gardener.size).toBeLessThanOrEqual(5);
      for (const g of gardener) expect(notes.filter((n) => n.text.toLowerCase().includes(g)).length).toBeGreaterThanOrEqual(2);
    });

    // At least 55% known, so no note is unreadable. The 75% ceiling is only for
    // the early and stile notes, where working words out is the point. Late
    // notes unlock after most common words, so a ceiling there forced rare
    // filler words into what should be the plainest notes.
    // Two learners read each note on the day it comes: one who knows the course's words in order, and the daily
    // learner. The ceiling is for the one working words out, the daily learner: with it by course place too, no
    // count would suit de n04.
    test("each note unlocks when the learner knows 55% of its words, and an early or stile note at most 75%", () => {
      const trace = DAILY[lang];
      for (const n of notes) {
        const byPlace = share(ink(n, (lemma) => (place.get(lemma) ?? Infinity) <= n.unlockAt));
        // !: every note comes by the door, where the trace stops (story.test.ts).
        const known = onDay(trace, dayKnowing(trace, n.unlockAt)!).lemmas;
        const daily = share(ink(n, (lemma) => known.has(lemma)));
        const ceiling = n.beat === "early" || n.beat === "stile" ? 0.75 : 1;
        expect({ id: n.id, byPlace: byPlace >= 0.55, daily: daily >= 0.55 && daily <= ceiling }).toEqual({ id: n.id, byPlace: true, daily: true });
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
