// Every story event of a course, with the gate that opens it (#928): the
// notes and the places they open, the thoughts, the frog's lines, the visitors
// and the key. One list, so whatever checks the story (the fact ledger, the
// pacing simulation, the demo's jumps) reads the gates the garden reads.
// A new gate goes here too: story.test.ts fails on one the list misses.

import type { GardenWord } from "../deck/schema";
import type { DeckLang } from "../deck/langs";
import { FROG_LINES, type FrogLine } from "./frogLines";
import { ANSWER_NOTE, HILL_NOTE } from "./lookout";
import type { Note } from "./notes/note";
import { courseNotes } from "./notes/read";
import { THOUGHTS } from "./thoughts";
import type { Thought } from "./thoughts/thought";
import { VISITORS, type VisitorId } from "./visitors";

/** What opens an event: words the learner knows (ui/visitors.ts knownWords), or a garden word (#209) first answered right (ui/visitors.ts broughtAt). */
type Gate = { known: number } | { garden: GardenWord };

/** A place in the walk that comes with a note. */
export type Opens = "stile" | "hill" | "diary" | "answer" | "door";

/** Which note brings each place (stile.ts placeNotes, scene.ts): `notes` in the order they come. */
const OPENS: Record<Opens, (n: Note, notes: readonly Note[]) => boolean> = {
  // Until the first stile note there is no stile, nor the hill and its stool behind it.
  stile: (n, notes) => n === notes.find((m) => m.beat === "stile"),
  hill: (n) => n.id === HILL_NOTE,
  diary: (n, notes) => n === notes.find((m) => m.diary),
  answer: (n) => n.id === ANSWER_NOTE,
  door: (n) => n.beat === "door",
};

export type StoryEvent = {
  gate: Gate;
  /**
   * Known words by which a learner has met it. A garden word's is its place in the course (from 1): a
   * learner never knows more words than they started, and they start words in course order.
   */
  at: number;
} & (
  | { kind: "note"; note: Note; opens: Opens[] }
  | { kind: "thought"; thought: Thought }
  | { kind: "frog"; line: FrogLine }
  | { kind: "visitor"; visitor: VisitorId }
  // The key hides in the garden, and opens the door in the hedge (#315).
  | { kind: "key" }
);

/** The garden word that brings the key (ui/GardenWalk.tsx). */
const KEY: GardenWord = "key";

/**
 * Every story event of a course, in the order a learner meets them. `course` is the deck's words in
 * course order (content/order.ts courseOrder): it places the garden words.
 */
export function storyEvents(lang: DeckLang, course: readonly { garden?: GardenWord }[]): StoryEvent[] {
  const at = (gate: Gate): number => {
    if ("known" in gate) return gate.known;
    const place = course.findIndex((w) => w.garden === gate.garden);
    if (place < 0) throw new Error(`no garden word "${gate.garden}" in the ${lang} course`);
    return place + 1;
  };
  const notes = courseNotes(lang);
  const events: StoryEvent[] = [
    ...notes.map((note): StoryEvent => {
      const opens = (Object.keys(OPENS) as Opens[]).filter((o) => OPENS[o](note, notes));
      return { kind: "note", gate: { known: note.unlockAt }, at: note.unlockAt, note, opens };
    }),
    ...THOUGHTS[lang].map((thought): StoryEvent => ({ kind: "thought", gate: { known: thought.unlockAt }, at: thought.unlockAt, thought })),
    ...FROG_LINES[lang].map((line): StoryEvent => ({ kind: "frog", gate: { known: line.unlockAt }, at: line.unlockAt, line })),
    // Each gate of a visitor is an event of its own: the frog comes with its word, or at 150 known words, whichever is first.
    // Visitors with no gate come by the calendar or are there from the first day: not part of the story.
    ...VISITORS.flatMap((v) => [
      ...(v.unlock === undefined ? [] : [{ known: v.unlock }]),
      ...(v.garden === undefined ? [] : [{ garden: v.garden }]),
    ].map((gate): StoryEvent => ({ kind: "visitor", gate, at: at(gate), visitor: v.id }))),
    { kind: "key", gate: { garden: KEY }, at: at({ garden: KEY }) },
  ];
  return events.sort((a, b) => a.at - b.at);
}
