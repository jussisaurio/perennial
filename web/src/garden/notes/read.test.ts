import { describe, expect, test } from "bun:test";
import type { Note } from "./note";
import { hasUnread, noteInk, unlockedNotes } from "./read";

// Fixtures: the real notes are written apart from the system (es.ts, de.ts).
const first: Note = { id: "n01", beat: "early", unlockAt: 20, text: "Fui al jardín.\nNo me gustan los caracoles.", forms: { fui: "ir", al: "a", gustan: "gustar", caracoles: "caracol" } };
const later: Note = { id: "n02", beat: "stile", unlockAt: 300, text: "Das Haus ist alt." };

const faintWords = (ink: { text: string; faint: boolean }[]) => ink.filter((i) => i.faint).map((i) => i.text);

describe("a note's words", () => {
  test("are clear when their lemma is known: the word itself, or its form's lemma", () => {
    const known = new Set(["ir", "jardín", "no", "caracol"]);
    const ink = noteInk(first, (l) => known.has(l));
    expect(faintWords(ink)).toEqual(["al", "me", "gustan", "los"]);
    // Nothing is lost: line breaks and punctuation are kept, and never faint.
    expect(ink.map((i) => i.text).join("")).toBe(first.text);
  });

  test("match by lower case, so a capital at the start of a line or a German noun still counts", () => {
    const known = new Set(["das", "haus"]);
    expect(faintWords(noteInk(later, (l) => known.has(l)))).toEqual(["ist", "alt"]);
  });
});

describe("the notes on the nails", () => {
  test("come by known words, in the order they unlock", () => {
    expect(unlockedNotes([later, first], 19)).toEqual([]);
    expect(unlockedNotes([later, first], 20)).toEqual([first]);
    expect(unlockedNotes([later, first], 300).map((n) => n.id)).toEqual(["n01", "n02"]);
  });

  test("count as new until each unlocked one is read", () => {
    expect(hasUnread([first, later], 10, [])).toBe(false);
    expect(hasUnread([first, later], 50, [])).toBe(true);
    expect(hasUnread([first, later], 50, ["n01"])).toBe(false);
    expect(hasUnread([first, later], 300, ["n01"])).toBe(true);
  });
});
