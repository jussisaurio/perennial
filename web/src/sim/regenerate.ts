// Writes the learner traces (sim/learner.ts) to sim/traces/, two files per
// course and pattern (seed 1 day by day, and the known counts of every seed),
// and prints the tables for the notes' pacing (#883).
// `bun run sim:learners`; learner.ts says when to run it again.

import "./noViteDecks";
import { DECK_LANGS } from "../deck/langs";
import type { WordsPart } from "../data/deckIndex";
import { dayKnowing, knownByDay, medianDayKnowing, onDay, PATTERNS, type Runs, type Trace } from "./trace";

const { simulate } = await import("./learner");
const { courseNotes } = await import("../garden/notes/read");

/**
 * Three years: long enough for every pattern to reach the door, so the traces
 * hold each whole story (the slowest, weekdays only, took about 1.6 years
 * after the retune, #883). A trace that stops here first says so (doorDay
 * null): that is a finding for the pacing, not a run to make longer.
 */
const MAX_DAYS = 3 * 365;
/**
 * Seeds 1 to SEEDS run for each course and pattern, and the story's pace is
 * tested on their median (trace.ts Runs). Odd, so the median is one run's day.
 * With 25, the deck change in #969 moved the median door by 3 days in es and
 * 17 in de; seed 1 alone moved by 39 and 72 days (#952).
 */
const SEEDS = 25;
/** The days the summary table shows: the first months, then each year. */
const MARKS = [30, 60, 90, 180, 365, 730, 1095];

const started = performance.now();
const traces: { trace: Trace; runs: Runs }[] = [];
for (const lang of DECK_LANGS) {
  // CI decodes every deck with the full schema (scripts/deck/check.ts), so the app trusts its shape (data/deck.ts), and so does this.
  const deck: WordsPart = await Bun.file(new URL(`../../../decks/${lang}/deck.json`, import.meta.url)).json();
  for (const pattern of PATTERNS) {
    const all: Trace[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) all.push(await simulate({ deck, pattern, seed, maxDays: MAX_DAYS }));
    // Seed 1 is kept day by day: the learner whose words the notes' tests and the reader's script follow.
    const trace = all[0];
    // One day a line: a rerun's diff shows which days moved.
    const { days, ...head } = trace;
    const text = `${JSON.stringify(head).slice(0, -1)},"days":[\n${days.map((d) => JSON.stringify(d)).join(",\n")}\n]}\n`;
    await Bun.write(new URL(`./traces/${lang}-${pattern}.json`, import.meta.url), text);
    const runs: Runs = { lang, pattern, door: trace.door, runs: all.map((t) => ({ seed: t.seed, known: knownByDay(t) })) };
    const { runs: rows, ...runsHead } = runs;
    const runsText = `${JSON.stringify(runsHead).slice(0, -1)},"runs":[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]}\n`;
    await Bun.write(new URL(`./traces/${lang}-${pattern}-seeds.json`, import.meta.url), runsText);
    traces.push({ trace, runs });
    console.error(`${lang} ${pattern}: door ${trace.door} on day ${trace.doorDay ?? "-"} for seed 1, ${medianDayKnowing(runs, trace.door) ?? "-"} for the median (${Math.round((performance.now() - started) / 1000)} s)`);
  }
}

// !: every pattern practises on day 1.
const last = (t: Trace) => t.days.at(-1)!.day;
console.log(`Seed 1, and the median of ${SEEDS} seeds:\n`);
console.log(`| course | pattern | ${MARKS.map((d) => `day ${d}`).join(" | ")} | door (known) | door day | median door day |`);
console.log(`|---|---|${MARKS.map(() => "---|").join("")}---|---|---|`);
for (const { trace: t, runs } of traces) {
  // After the door the trace stops: no count for those days.
  const cells = MARKS.map((d) => (d <= last(t) ? String(onDay(t, d).known) : "-"));
  const never = `not by day ${MAX_DAYS}`;
  // `??`: null is a door not reached by the day cap.
  console.log(`| ${t.lang} | ${t.pattern} | ${cells.join(" | ")} | ${t.door} | ${t.doorDay ?? never} | ${medianDayKnowing(runs, t.door) ?? never} |`);
}

console.log("\nThe day the daily learner first knows each note's count:\n");
console.log("| course | note | beat | known | seed 1 | median |");
console.log("|---|---|---|---|---|---|");
for (const { trace: t, runs } of traces.filter(({ trace }) => trace.pattern === "daily")) {
  for (const n of courseNotes(t.lang)) {
    // `?? "-"`: a note the trace never reaches; every one should come by the door.
    console.log(`| ${t.lang} | ${n.id} | ${n.beat} | ${n.unlockAt} | ${dayKnowing(t, n.unlockAt) ?? "-"} | ${medianDayKnowing(runs, n.unlockAt) ?? "-"} |`);
  }
}
console.error(`done in ${Math.round((performance.now() - started) / 1000)} s`);
