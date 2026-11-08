import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import deckEs from "../../../../decks/es/deck.json";
import deckDe from "../../../../decks/de/deck.json";
import { courseOrder } from "../../content/order";
import { Deck } from "../../deck/schema";
import { dayKnowing, onDay, type Trace } from "../../sim/trace";
import { noteInk } from "../notes/read";
import { THOUGHTS, thoughtFor } from ".";
import { FROG_LINES, frogLines, type FrogLine } from "../frogLines";

const THINGS = ["bench", "stool", "pond", "sunflower", "sundial", "hills", "bed", "hedge", "grass", "stone", "cherry", "lantern", "moon"];

// As in notes.test.ts: the simulated daily learner, who knows fewer words than course place says (#938).
const DAILY: Record<"es" | "de", Trace> = {
  es: await Bun.file(new URL("../../sim/traces/es-daily.json", import.meta.url)).json(),
  de: await Bun.file(new URL("../../sim/traces/de-daily.json", import.meta.url)).json(),
};

for (const [lang, deck] of [["es", deckEs], ["de", deckDe]] as const) {
  describe(`${lang} thoughts`, () => {
    // As in notes.test.ts: a lemma is known once the learner knows this many course words, its place counting from 1.
    const course = courseOrder({ words: Schema.decodeUnknownSync(Deck(lang))(deck).words.filter((w) => !w.retired && !w.aliasOf) });
    const place = new Map<string, number>();
    course.forEach((w, i) => {
      const lemma = w.lemma.normalize("NFC").toLowerCase();
      if (!place.has(lemma)) place.set(lemma, i + 1);
    });
    const thoughts = THOUGHTS[lang];
    const words = (text: string) => text.match(/[\p{L}\p{M}]+/gu) ?? [];
    /**
     * The words of each line that a learner does not know on the day it unlocks: by course place, or for the daily
     * learner. The trace stops at the door, so a line that unlocks after it is read by course place alone.
     * A lemma missing from the deck is never known, so this names it.
     */
    const unknown = (lines: readonly FrogLine[]) =>
      lines.flatMap((t) => {
        const day = dayKnowing(DAILY[lang], t.unlockAt);
        const daily = day === null ? null : onDay(DAILY[lang], day).lemmas;
        return noteInk(t, (lemma) => (place.get(lemma) ?? Infinity) <= t.unlockAt && (daily === null || daily.has(lemma)))
          .filter((ink) => ink.style === "faint")
          .map((ink) => `${t.text}: ${ink.text}`);
      });

    test("every word of a line is known when it unlocks", () => {
      expect(unknown(thoughts)).toEqual([]);
    });

    // The frog's lines (#902) are gated the same way.
    test("every word of a frog line is known when it unlocks, and its last line comes first", () => {
      const lines = FROG_LINES[lang];
      expect(unknown(lines)).toEqual([]);
      // Its last line says it has no more words: whenever it has lines, that one is among them, at the end.
      const last = lines[lines.length - 1];
      for (const l of lines) expect(l.unlockAt).toBeGreaterThanOrEqual(last.unlockAt);
      expect(frogLines(lang, last.unlockAt - 1)).toEqual([]);
    });

    test("each thing has one to three lines of at most six words, richer as words grow", () => {
      expect([...new Set(thoughts.map((t) => t.thing))].sort()).toEqual([...THINGS].sort());
      for (const thing of THINGS) {
        const lines = thoughts.filter((t) => t.thing === thing);
        expect(lines.length).toBeGreaterThanOrEqual(1);
        expect(lines.length).toBeLessThanOrEqual(3);
        for (let i = 1; i < lines.length; i++) expect(lines[i].unlockAt).toBeGreaterThan(lines[i - 1].unlockAt);
      }
      for (const t of thoughts) expect({ text: t.text, ok: words(t.text).length <= 6 }).toEqual({ text: t.text, ok: true });
    });

    test("a tap shows the newest line the learner can read, and none before the first", () => {
      const pond = thoughts.filter((t) => t.thing === "pond");
      expect(thoughtFor(lang, "pond", pond[0].unlockAt - 1)).toBeNull();
      expect(thoughtFor(lang, "pond", pond[0].unlockAt)).toBe(pond[0].text);
      expect(thoughtFor(lang, "pond", pond[2].unlockAt - 1)).toBe(pond[1].text);
      expect(thoughtFor(lang, "pond", Infinity)).toBe(pond[2].text);
      expect(thoughtFor(lang, "sky", Infinity)).toBeNull();
    });

    // e2e/thoughts.spec.ts thought.grows taps the pond at these demo counts.
    test("the pond has a different line at 200, 700 and 1800 known words", () => {
      const lines = [200, 700, 1800].map((n) => thoughtFor(lang, "pond", n));
      expect(new Set(lines).size).toBe(3);
      expect(lines).not.toContain(null);
    });
  });
}
