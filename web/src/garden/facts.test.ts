// The story's facts (facts.ts) against the order a learner meets them (#928):
// no line needs a fact before a note has told it, and both courses tell the
// same facts in the same part of the story.

import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import deckEs from "../../../decks/es/deck.json";
import deckDe from "../../../decks/de/deck.json";
import { courseOrder } from "../content/order";
import { Deck } from "../deck/schema";
import { FACTS, UNTOLD, type Fact } from "./facts";
import { storyEvents, type StoryEvent } from "./story";

/** The course's live words in course order, as the app has them (data/deck.ts, content/order.ts). */
const course = (lang: "es" | "de", deck: unknown) =>
  courseOrder({ words: Schema.decodeUnknownSync(Deck(lang))(deck).words.filter((w) => !w.retired && !w.aliasOf) });
const EVENTS = { es: storyEvents("es", course("es", deckEs)), de: storyEvents("de", course("de", deckDe)) };

/** What an event tells, and what it needs known already, with a name to find it by. */
function tags(e: StoryEvent): { name: string; reveals: readonly Fact[]; assumes: readonly Fact[] } {
  // `?? []`: a line that tells or needs nothing leaves the list out.
  switch (e.kind) {
    case "note":
      return { name: e.note.id, reveals: e.note.reveals ?? [], assumes: e.note.assumes ?? [] };
    // A thought or the frog's line notices; it never tells the story (#884), so it has no `reveals`.
    case "thought":
      return { name: `${e.thought.thing}: ${e.thought.text}`, reveals: [], assumes: e.thought.assumes ?? [] };
    case "frog":
      return { name: `frog: ${e.line.text}`, reveals: [], assumes: e.line.assumes ?? [] };
    case "visitor":
    case "key":
      return { name: e.kind, reveals: [], assumes: [] };
  }
}

/** The count at which a note first tells each fact. */
function toldAt(events: readonly StoryEvent[]): Map<Fact, number> {
  const told = new Map<Fact, number>();
  for (const e of events) for (const f of tags(e).reveals) if (!told.has(f)) told.set(f, e.at);
  return told;
}

for (const lang of ["es", "de"] as const) {
  describe(`${lang} story facts`, () => {
    const events = EVENTS[lang];
    const told = toldAt(events);

    test("no line needs a fact before a note tells it", () => {
      // Strictly before. At one count the learner may meet either first: the shed's nail, the diary on the hill
      // and a tap on a thing all wait for them. So a line at the same count as its fact is ahead of the story.
      const ahead = events.flatMap((e) =>
        tags(e)
          // `?? Infinity`: a fact no note tells is never told in time.
          .assumes.filter((f) => !(f in UNTOLD) && !((told.get(f) ?? Infinity) < e.at))
          .map((f) => `${tags(e).name} at ${e.at} needs "${f}", told at ${told.get(f) ?? "no note"}`),
      );
      expect(ahead).toEqual([]);
    });

    test("every fact is told, or waits on an issue in UNTOLD", () => {
      expect((Object.keys(FACTS) as Fact[]).filter((f) => !told.has(f) && !(f in UNTOLD))).toEqual([]);
      // An UNTOLD fact is still needed and still untold: once a note tells it, its entry goes.
      for (const f of Object.keys(UNTOLD) as Fact[]) {
        expect([f, told.has(f), events.some((e) => tags(e).assumes.includes(f))]).toEqual([f, false, true]);
      }
    });
  });
}

test("both courses tell the same facts in the same part of the story", () => {
  /** Each beat's facts, from its notes. */
  const byBeat = (events: readonly StoryEvent[]) => {
    const notes = events.filter((e) => e.kind === "note");
    const facts = (beat: string) => [...new Set(notes.filter((e) => e.note.beat === beat).flatMap(tags).flatMap((t) => t.reveals))].sort();
    return Object.fromEntries(notes.map((e) => [e.note.beat, facts(e.note.beat)]));
  };
  expect(byBeat(EVENTS.de)).toEqual(byBeat(EVENTS.es));
});
