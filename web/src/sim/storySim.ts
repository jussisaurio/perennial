// The story as one simulated learner meets it (#928): the timeline and its
// pacing metrics (sim/timeline.ts), from a cached trace (sim/traces/).
// `bun run story:sim <lang> <pattern>`; `--json` for the story loop
// (docs/story-loop.md); `--script <dir>` writes the reader's script there.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { courseOrder } from "../content/order";
import { indexWords, type WordsPart } from "../data/deckIndex";
import { isDeckLang } from "../deck/langs";
import { storyEvents, type StoryEvent } from "../garden/story";
import { readerScript } from "./script";
import { courseStory, projectStory, quietStretches, weekOf, written, type Met, type Projection } from "./timeline";
import { PATTERNS, type Pattern, type Trace } from "./trace";

const USAGE = "usage: bun run story:sim <lang> <pattern> [--json] [--script <dir>]";
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const scriptAt = args.indexOf("--script");
const scriptDir = scriptAt < 0 ? null : args[scriptAt + 1];
const [lang, pattern] = args.filter((a, i) => !a.startsWith("--") && (scriptAt < 0 || i !== scriptAt + 1));
if (!lang || !isDeckLang(lang) || !PATTERNS.includes(pattern as Pattern) || scriptDir === undefined) {
  console.error(USAGE);
  process.exit(1);
}

// CI decodes every deck with the full schema (scripts/deck/check.ts) and the
// traces are written by sim:learners, so this trusts both shapes, as regenerate.ts does.
const deck: WordsPart = await Bun.file(new URL(`../../../decks/${lang}/deck.json`, import.meta.url)).json();
const trace: Trace = await Bun.file(new URL(`./traces/${lang}-${pattern}.json`, import.meta.url)).json();
const course = courseOrder(indexWords(deck, lang));
if (course.length !== trace.words) console.error(`note: the deck has ${course.length} live words, the trace ${trace.words}: run bun run sim:learners`);
// As the app has them: ui/visitors.ts knownWords lower-cases a lemma.
const story = courseStory(storyEvents(lang, course), new Set(course.map((w) => w.lemma.toLowerCase())));
const p = projectStory(trace, story);

/** A short name for an event. */
function label(e: StoryEvent): string {
  switch (e.kind) {
    case "note":
      return [`${e.note.id} ${e.note.beat}`, ...e.opens.map((o) => `opens ${o}`)].join(", ");
    case "thought":
      return e.thought.thing;
    case "frog":
      return "frog line";
    case "visitor":
      return `the ${e.visitor} comes`;
    case "key":
      return "the key";
  }
}

const text = (m: Met) => written(m.event)?.text.replace(/\n+/g, " / ") ?? "";
const pct = (share: number | undefined) => (share === undefined ? "" : `${Math.round(share * 100)}%`);
/** Weeks as runs: "4–6, 9". */
const runs = (weeks: readonly number[]) =>
  weeks
    .reduce<[number, number][]>((out, w) => {
      const last = out.at(-1);
      if (last && last[1] === w - 1) last[1] = w;
      else out.push([w, w]);
      return out;
    }, [])
    .map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`))
    .join(", ");

if (scriptDir) {
  await mkdir(scriptDir, { recursive: true });
  const files = readerScript(p, trace, lang, story.gardener);
  for (const [name, body] of files) await Bun.write(join(scriptDir, name), body);
  console.error(`wrote ${files.size} files to ${scriptDir}`);
}

if (flag("--json")) {
  const { met, unmet, ...rest } = p;
  const rows = met.map((m) => ({ day: m.day, known: m.known, kind: m.event.kind, tier: m.tier, what: label(m.event), share: m.share, text: text(m) || undefined }));
  console.log(JSON.stringify({ lang, pattern, words: trace.words, door: trace.door, ...rest, met: rows, unmet: unmet.map(label) }, null, 1));
} else {
  printText(p);
}

function printText({ met, unmet, end, metrics: m }: Projection) {
  console.log(`${lang} ${pattern} (seed ${trace.seed}): ${trace.words} words; the door at ${trace.door} known, ${trace.doorDay === null ? `not reached by day ${end}` : `day ${trace.doorDay}`}.`);
  console.log("Assumes: a note is read the day it comes; a thought is tapped the day it comes (the stool's once the hill is open); the frog's lines are heard once it lives here.\n");
  console.log("  day  known  tier     what                       read  text");
  for (const r of met) console.log(`${String(r.day).padStart(5)}  ${String(r.known).padStart(5)}  ${r.tier.padEnd(7)}  ${label(r.event).padEnd(25).slice(0, 25)}  ${pct(r.share).padStart(4)}  ${text(r).slice(0, 80)}`);
  console.log(`\nNote gaps (days): ${m.noteGaps.map((g) => `${g.from}→${g.to} ${g.days}`).join(", ")}`);
  const gaps = m.noteGaps.map((g) => g.days);
  console.log(`  longest ${Math.max(...gaps)}, mean ${Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)} (target: a note every 3–4 weeks, 21–28 days)`);
  if (m.longestQuiet) console.log(`Longest stretch with nothing new: days ${m.longestQuiet.from}–${m.longestQuiet.to} (${m.longestQuiet.to - m.longestQuiet.from + 1} days)`);
  const long = quietStretches([...new Set(met.map((r) => r.day))], end).filter((q) => q.to - q.from + 1 >= 28);
  console.log(`Stretches of 4 weeks or more with nothing new: ${long.length ? long.map((q) => `${q.from}–${q.to}`).join(", ") : "none"}`);
  console.log(`New things a week: ${m.perWeek.toFixed(2)} (target: about 1); big ${m.tiers.big}, small ${m.tiers.small}, texture ${m.tiers.texture}`);
  console.log(`Weeks with nothing new: ${m.quietWeeks.length} of ${weekOf(end)}: ${runs(m.quietWeeks) || "none"}`);
  console.log(`Clumps (more than 2 notes on a day): ${m.clumps.length ? m.clumps.map((c) => `day ${c.day}: ${c.notes.join(", ")}`).join("; ") : "none"}`);
  console.log(`Stale thoughts (2+ notes and 8+ weeks while one shows): ${m.stale.length ? "" : "none"}`);
  for (const s of m.stale) console.log(`  ${s.thing} "${s.text}": days ${s.from}–${s.until - 1}, ${s.notes} notes`);
  console.log(`Door: ${m.doorDay === null ? `not reached; the trace stops on day ${end}` : `day ${m.doorDay}`}`);
  if (unmet.length) console.log(`Never met: ${unmet.map(label).join(", ")}`);
}
