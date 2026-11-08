// How the gardener's notes read (#654): which ones hang in the shed, and
// which of their words are clear. Pure, so it is easy to test.

import { inLang } from "../nouns";
import { NOTES } from "./index";
import { ENDING_SHARE, type Note, type WrittenNote } from "./note";

/** This course's notes as written. Every course has an entry (notes/index.ts), so a missing one is a bug. */
export function writtenNotes(lang: string): readonly WrittenNote[] {
  const notes = inLang(NOTES, lang);
  if (!notes) throw new Error(`no notes for course "${lang}"`);
  return notes;
}

/** This course's notes, the door's placed at ENDING_SHARE of the course's `deckWords` live words (#882). */
export function courseNotes(lang: string, deckWords: number): Note[] {
  return writtenNotes(lang).map((n) => (n.beat === "door" ? { ...n, unlockAt: Math.ceil(ENDING_SHARE * deckWords) } : n));
}

/**
 * The notes found by a learner who knows `known` words (the count the
 * visitors use, ui/visitors.ts knownWords), in the order they came. A note
 * once read stays found, even when its count moves past the learner (the
 * door's moves as the deck grows).
 */
export function unlockedNotes(notes: readonly Note[], known: number, read: readonly string[]): Note[] {
  return notes.filter((n) => n.unlockAt <= known || read.includes(n.id)).sort((a, b) => a.unlockAt - b.unlockAt);
}

/** Is there a found note the learner has not read yet? */
export function hasUnread(notes: readonly Note[], known: number, read: readonly string[]): boolean {
  return unlockedNotes(notes, known, read).some((n) => !read.includes(n.id));
}

/**
 * A run of a note's text and how it is written: a word the learner does not know is faint; a word the gardener
 * crossed out (`~~x~~` in the text) is struck, and never faint. Spaces, line breaks and punctuation are clear.
 */
export interface Ink {
  text: string;
  style: "clear" | "faint" | "struck";
}

/** A word the gardener crossed out (its text in group 1), or a word: letters (with their accents), and an apostrophe inside one ("geht's"). */
const WORD = /~~([^~]+)~~|[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;

/**
 * A note's text, word by word. A word is clear when the learner knows its
 * lemma: its lower-case form, or the note's `forms` for one whose deck lemma
 * differs ("fui" → "ir"). `isKnown` gets a lower-case lemma.
 */
export function noteInk(note: Pick<Note, "text" | "forms">, isKnown: (lemma: string) => boolean): Ink[] {
  const ink: Ink[] = [];
  let at = 0;
  for (const m of note.text.matchAll(WORD)) {
    if (m.index > at) ink.push({ text: note.text.slice(at, m.index), style: "clear" });
    at = m.index + m[0].length;
    if (m[1] !== undefined) {
      ink.push({ text: m[1], style: "struck" });
      continue;
    }
    const surface = m[0].toLowerCase();
    // `??`: most words are their own lemma; `forms` lists only the ones that are not.
    ink.push({ text: m[0], style: isKnown(note.forms?.[surface] ?? surface) ? "clear" : "faint" });
  }
  if (at < note.text.length) ink.push({ text: note.text.slice(at), style: "clear" });
  return ink;
}
