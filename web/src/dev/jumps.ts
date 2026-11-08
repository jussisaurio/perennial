// The story points the demo can jump to (#751), from the gates the garden
// already has: each note's unlockAt, the visitors that come at a known-word
// count, and the notes that open the stile, the hill and the far light.
// Not a list of its own: a new note or gate shows up here by itself.

import { ANSWER_NOTE, HILL_NOTE } from "../garden/lookout";
import { courseNotes } from "../garden/notes/read";
import type { Note } from "../garden/notes/note";
import { VISITORS } from "../garden/visitors";
import type { DeckLang } from "../deck/langs";

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
function noteTitle(n: Note, notes: readonly Note[]): string {
  if (n.id === HILL_NOTE) return "The way over the stile opens";
  if (n.id === ANSWER_NOTE) return "The far light answers";
  if (n === notes.find((m) => m.beat === "stile")) return "The stile stands";
  if (n === notes.find((m) => m.diary)) return "The diary lies on the hill";
  if (n.diary) return `Diary page ${notes.filter((m) => m.diary).indexOf(n) + 1}`;
  return `Note ${Number(n.id.slice(1))}`;
}

/** The note's first line, without the words the gardener crossed out. */
const firstLine = (n: Note) => n.text.split("\n")[0].replace(/~~[^~]+~~\s*/g, "");

/** Every story point of the course, in the order a learner meets them. */
export function storyJumps(lang: DeckLang): Jump[] {
  const notes = courseNotes(lang);
  const jumps: Jump[] = notes.map((n) => ({ known: n.unlockAt, title: noteTitle(n, notes), line: firstLine(n), part: PART[n.beat] }));
  for (const v of VISITORS) {
    if (v.unlock !== undefined) jumps.push({ known: v.unlock, title: `The ${v.gloss} moves in`, line: v.words[lang], part: "Visitors" });
  }
  return jumps.sort((a, b) => a.known - b.known);
}
