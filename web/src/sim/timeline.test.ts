import { expect, test } from "bun:test";
import type { Note } from "../garden/notes/note";
import type { StoryEvent } from "../garden/story";
import { projectStory } from "./timeline";
import type { Trace } from "./trace";

const note = (id: string, unlockAt: number, text: string, opens: Extract<StoryEvent, { kind: "note" }>["opens"] = []): StoryEvent => ({
  kind: "note",
  gate: { known: unlockAt },
  at: unlockAt,
  note: { id, beat: "early", unlockAt, text } satisfies Note,
  opens,
});

// A made-up learner: practice days only, the door never reached.
const trace: Trace = {
  lang: "es",
  pattern: "daily",
  seed: 1,
  start: "2026-01-05",
  words: 100,
  door: 90,
  doorDay: null,
  days: [
    { day: 1, minutes: 5, known: 3, gained: ["el", "gato"] },
    { day: 2, minutes: 5, known: 5 },
    { day: 3, minutes: 5, known: 10, gained: ["es"] },
    { day: 10, minutes: 5, known: 20 },
    { day: 15, minutes: 5, known: 25, brought: ["frog"] },
    { day: 20, minutes: 5, known: 30 },
    { day: 70, minutes: 5, known: 31 },
  ],
};

const events: StoryEvent[] = [
  note("n1", 10, "El ~~perro~~ gato es mío, zarzas."),
  { kind: "thought", gate: { known: 3 }, at: 3, thought: { thing: "bench", unlockAt: 3, text: "Es para dos." } },
  // The stool stands on the hill: met the day after the note that opens the way up.
  { kind: "thought", gate: { known: 5 }, at: 5, thought: { thing: "stool", unlockAt: 5, text: "Es para uno.", assumes: ["the-far-light"] } },
  note("n2", 20, "La colina.", ["hill"]),
  // The frog comes with its word on day 15, before its count: one arrival, and its line waits for it.
  { kind: "visitor", gate: { known: 30 }, at: 30, visitor: "frog" },
  { kind: "visitor", gate: { garden: "frog" }, at: 12, visitor: "frog" },
  { kind: "frog", gate: { known: 5 }, at: 5, line: { unlockAt: 5, text: "¿Otra vez tú?" } },
  note("n3", 30, "Uno."),
  note("n4", 30, "Dos."),
  note("n5", 30, "Tres."),
  // Never within the trace.
  { kind: "key", gate: { garden: "key" }, at: 50 },
  { kind: "thought", gate: { known: 100 }, at: 100, thought: { thing: "pond", unlockAt: 100, text: "Agua." } },
];

test("the story by the day a learner meets it, and its pacing", () => {
  const p = projectStory(trace, { events, gardener: new Set(["zarzas"]) });
  const label = (e: StoryEvent) => (e.kind === "note" ? e.note.id : e.kind === "thought" ? e.thought.thing : e.kind === "visitor" ? e.visitor : e.kind);
  expect(p.met.map((m) => [m.day, label(m.event)])).toEqual([
    [1, "bench"],
    [3, "n1"],
    [10, "n2"],
    [11, "stool"],
    [15, "frog"],
    [15, "frog"],
    [20, "n3"],
    [20, "n4"],
    [20, "n5"],
  ]);
  expect(p.unmet.map(label)).toEqual(["key", "pond"]);
  expect(p.end).toBe(70);
  // El, gato and es of El gato es mío: the crossed-out word and the gardener's are not counted.
  expect(p.met.find((m) => label(m.event) === "n1")?.share).toBe(3 / 4);
  expect(p.metrics).toEqual({
    noteGaps: [
      { from: "n1", to: "n2", days: 7 },
      { from: "n2", to: "n3", days: 10 },
      { from: "n3", to: "n4", days: 0 },
      { from: "n4", to: "n5", days: 0 },
    ],
    longestQuiet: { from: 21, to: 70 },
    perWeek: 9 / 10,
    quietWeeks: [4, 5, 6, 7, 8, 9, 10],
    // The stool's line needs a fact from the notes; the bench's, the frog and its line need none.
    tiers: { big: 5, small: 1, texture: 3 },
    clumps: [{ day: 20, notes: ["n3", "n4", "n5"] }],
    // Each shows to the end while the notes move on; the bench's for 70 days.
    stale: [
      { thing: "bench", text: "Es para dos.", from: 1, until: 71, notes: 5 },
      { thing: "stool", text: "Es para uno.", from: 11, until: 71, notes: 3 },
    ],
    doorDay: null,
  });
});
