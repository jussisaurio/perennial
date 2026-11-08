import { describe, expect, test } from "bun:test";
import type { Note } from "./note";
import { hasUnread, noteInk, unlockedNotes, type Ink } from "./read";

// Fixtures: the real notes are written apart from the system (es.ts, de.ts).
const first: Note = { id: "n01", beat: "early", unlockAt: 20, text: "Fui al jardín.\nNo me gustan los caracoles.", forms: { fui: "ir", al: "a", gustan: "gustar", caracoles: "caracol" } };
const later: Note = { id: "n02", beat: "stile", unlockAt: 300, text: "Das Haus ist alt." };

const faintWords = (ink: Ink[]) => ink.filter((i) => i.style === "faint").map((i) => i.text);

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

  test("crossed out by the gardener (~~x~~) are struck, without the marks and never faint; the word after reads as any other", () => {
    const fixed: Note = { id: "n03", beat: "early", unlockAt: 20, text: "Hoy ~~soy~~ estoy.", forms: { estoy: "estar" } };
    expect(noteInk(fixed, (l) => l === "estar")).toEqual([
      { text: "Hoy", style: "faint" },
      { text: " ", style: "clear" },
      { text: "soy", style: "struck" },
      { text: " ", style: "clear" },
      { text: "estoy", style: "clear" },
      { text: ".", style: "clear" },
    ]);
  });
});

describe("the notes on the nails", () => {
  test("come by known words, in the order they unlock", () => {
    expect(unlockedNotes([later, first], 19, [])).toEqual([]);
    expect(unlockedNotes([later, first], 20, [])).toEqual([first]);
    expect(unlockedNotes([later, first], 300, []).map((n) => n.id)).toEqual(["n01", "n02"]);
  });

  // A retune moves notes' counts (#883): a learner who read n03 at 130 words keeps it when it moves to 160.
  test("stay found once read, even when one's count moves past the learner", () => {
    expect(unlockedNotes([later, first], 50, ["n02"]).map((n) => n.id)).toEqual(["n01", "n02"]);
    expect(hasUnread([first, later], 50, ["n01", "n02"])).toBe(false);
  });

  test("count as new until each unlocked one is read", () => {
    expect(hasUnread([first, later], 10, [])).toBe(false);
    expect(hasUnread([first, later], 50, [])).toBe(true);
    expect(hasUnread([first, later], 50, ["n01"])).toBe(false);
    expect(hasUnread([first, later], 300, ["n01"])).toBe(true);
  });
});
