import { expect, mock, test } from "bun:test";
import deckEs from "../../../decks/es/deck.json";
import type { WordsPart } from "../data/deckIndex";

// The decks load through Vite; the simulation gets its deck from the file.
mock.module("../data/deck", () => ({
  loadDeck: () => Promise.reject(new Error("no decks here")),
  loadedDeck: () => undefined,
  loadSentences: () => Promise.reject(new Error("no decks here")),
  loadedSentences: () => undefined,
}));
const { simulate } = await import("./learner");

// The committed traces must not change on a rerun with nothing else changed:
// no wall clock and no unseeded randomness may reach the learner.
test("a simulated learner is the same on every run", async () => {
  // CI checks the deck files against the schema (scripts/deck/check.ts).
  const run = () => simulate({ deck: deckEs as WordsPart, pattern: "more", seed: 1, maxDays: 10 });
  const first = await run();
  expect(first.days.at(-1)?.known).toBeGreaterThan(0);
  expect(await run()).toEqual(first);
});
