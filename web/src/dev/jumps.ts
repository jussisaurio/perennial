// The story points the demo can jump to (#751), from the story's own list
// (garden/story.ts): each note, the places the notes open, and the visitors
// that come at a known-word count. A new note or gate shows up here by itself.

import { courseOrder } from "../content/order";
import type { DeckLang } from "../deck/langs";
import type { DeckWord } from "../deck/schema";
import type { Note } from "../garden/notes/note";
import { storyEvents, type Opens } from "../garden/story";
import { visitor } from "../garden/visitors";

export interface Jump {
  /** Known words at this point: the demo learner knows exactly this many. */
  known: number;
  /** What happens here, in a few words. */
  title: string;
  /** The note's first line, in the course language; the visitor's word. */
  line: string;
  /** Where in the story: "Early", "The stile", … */
  part: string;
}

const PART: Record<Note["beat"], string> = { early: "Early", stile: "The stile", lookout: "The hill", late: "Late", door: "The door" };

/** What a note's arrival changes in the garden, beyond the note itself. */
const OPENS_TITLE: Record<Opens, string> = {
  stile: "The stile stands",
  hill: "The way over the stile opens",
  diary: "The diary lies on the hill",
  answer: "The far light answers",
  door: "The mouse door opens",
};

function noteTitle(n: Note, opens: readonly Opens[], notes: readonly Note[]): string {
  if (opens.length) return opens.map((o) => OPENS_TITLE[o]).join(". ");
  if (n.diary) return `Diary page ${notes.filter((m) => m.diary).indexOf(n) + 1}`;
  return `Note ${Number(n.id.slice(1))}`;
}

/** The note's first line, without the words the gardener crossed out. */
const firstLine = (n: Note) => n.text.split("\n")[0].replace(/~~[^~]+~~\s*/g, "");

/** Every story point of a course with this deck of live words, in the order a learner meets them. */
export function storyJumps(lang: DeckLang, deck: { words: readonly DeckWord[] }): Jump[] {
  const events = storyEvents(lang, courseOrder(deck));
  const notes = events.flatMap((e) => (e.kind === "note" ? [e.note] : []));
  return events.flatMap((e): Jump[] => {
    if (e.kind === "note") return [{ known: e.at, title: noteTitle(e.note, e.opens, notes), line: firstLine(e.note), part: PART[e.note.beat] }];
    // Not a garden word's: the demo learner studies words by how common they are, not in course order (dev/plan.ts),
    // so knowing a count says nothing of which garden words it has.
    if (e.kind === "visitor" && "known" in e.gate) {
      const v = visitor(e.visitor);
      return [{ known: e.at, title: `The ${v.gloss} moves in`, line: v.words[lang], part: "Visitors" }];
    }
    // A thought or a frog's line is a tap away at every later point, so it needs no point of its own.
    return [];
  });
}
