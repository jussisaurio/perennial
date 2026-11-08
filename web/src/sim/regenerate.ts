// Writes the learner traces (sim/learner.ts) to sim/traces/, one file per
// course and pattern, and prints the tables for the notes' pacing (#883).
// `bun run sim:learners`; learner.ts says when to run it again.

import { DECK_LANGS } from "../deck/langs";
import type { WordsPart } from "../data/deckIndex";
import { dayKnowing, onDay, PATTERNS, type Trace } from "./trace";

// data/deck.ts loads the decks through Vite (import.meta.glob), which Bun does
// not have. The simulation reads its decks from the files below instead, so
// that module is stubbed before the simulation is loaded.
Bun.plugin({
  name: "no Vite decks",
  setup(build) {
    build.onLoad({ filter: /\/data\/deck\.ts$/ }, () => ({
      contents: "const none = () => { throw new Error('no Vite here') }; export const loadDeck = none, loadSentences = none, loadedDeck = none, loadedSentences = none;",
      loader: "ts",
    }));
  },
});
const { simulate } = await import("./learner");
const { courseNotes } = await import("../garden/notes/read");

/**
 * Three years: long enough for every pattern to reach the door, so the traces
 * hold each whole story (the slowest, weekdays only, took about 1.6 years
 * after the retune, #883). A trace that stops here first says so (doorDay
 * null): that is a finding for the pacing, not a run to make longer.
 */
const MAX_DAYS = 3 * 365;
const SEED = 1;
/** The days the summary table shows: the first months, then each year. */
const MARKS = [30, 60, 90, 180, 365, 730, 1095];

const started = performance.now();
const traces: Trace[] = [];
for (const lang of DECK_LANGS) {
  // CI decodes every deck with the full schema (scripts/deck/check.ts), so the app trusts its shape (data/deck.ts), and so does this.
  const deck: WordsPart = await Bun.file(new URL(`../../../decks/${lang}/deck.json`, import.meta.url)).json();
  for (const pattern of PATTERNS) {
    const trace = await simulate({ deck, pattern, seed: SEED, maxDays: MAX_DAYS });
    // One day a line: a rerun's diff shows which days moved.
    const { days, ...head } = trace;
    const text = `${JSON.stringify(head).slice(0, -1)},"days":[\n${days.map((d) => JSON.stringify(d)).join(",\n")}\n]}\n`;
    await Bun.write(new URL(`./traces/${lang}-${pattern}.json`, import.meta.url), text);
    traces.push(trace);
    console.error(`${lang} ${pattern}: door ${trace.door} on day ${trace.doorDay ?? "-"} (${Math.round((performance.now() - started) / 1000)} s)`);
  }
}

// !: every pattern practises on day 1.
const last = (t: Trace) => t.days.at(-1)!.day;
console.log(`| course | pattern | ${MARKS.map((d) => `day ${d}`).join(" | ")} | door (known) | door day |`);
console.log(`|---|---|${MARKS.map(() => "---|").join("")}---|---|`);
for (const t of traces) {
  // After the door the trace stops: no count for those days.
  const cells = MARKS.map((d) => (d <= last(t) ? String(onDay(t, d).known) : "-"));
  console.log(`| ${t.lang} | ${t.pattern} | ${cells.join(" | ")} | ${t.door} | ${t.doorDay ?? `not by day ${MAX_DAYS}`} |`);
}

console.log("\nThe day the daily learner first knows each note's count:\n");
console.log("| course | note | beat | known | day |");
console.log("|---|---|---|---|---|");
for (const t of traces.filter((t) => t.pattern === "daily")) {
  for (const n of courseNotes(t.lang)) {
    // `?? "-"`: a note the trace never reaches; every one should come by the door.
    console.log(`| ${t.lang} | ${n.id} | ${n.beat} | ${n.unlockAt} | ${dayKnowing(t, n.unlockAt) ?? "-"} |`);
  }
}
console.error(`done in ${Math.round((performance.now() - started) / 1000)} s`);
