// `bun run real-use:sim [--json]`: the real-use report (report.ts) on the
// simulated learner (sim/learner.ts), seed 1, daily practice, per course. That
// learner remembers with FSRS's own chance, so its calibration is right by
// construction: the baseline that a real learner's numbers are read against
// (docs/real-use.md).

import "../sim/noViteDecks";
import { DAY_MS } from "../core/day";
import { DECK_LANGS } from "../deck/langs";
import { indexWords, wordResolver, type WordsPart } from "../data/deckIndex";
import { COURSE_DEFAULTS } from "../data/rows";
import { courseNotes } from "../garden/notes/read";
import { report, text, type StoredCourse, type StoredReview } from "./report";

const { simulate } = await import("../sim/learner");

const courses: StoredCourse[] = [];
let end = 0;
for (const lang of DECK_LANGS) {
  // CI decodes every deck with the full schema (scripts/deck/check.ts), so this trusts its shape, as sim/regenerate.ts does.
  const part: WordsPart = await Bun.file(new URL(`../../../decks/${lang}/deck.json`, import.meta.url)).json();
  const reviews: StoredReview[] = [];
  // Sent as made: the sim has no network.
  await simulate({ deck: part, pattern: "daily", seed: 1, maxDays: 365, onReview: (r) => reviews.push({ ...r, received_at: r.reviewed_at }) });
  // !: a year of daily practice has answers.
  end = Math.max(end, Date.parse(reviews.at(-1)!.reviewed_at));
  // The sim's learner has no words of their own (no links), and never opens a note.
  courses.push({ user_id: `sim-${lang}`, lang, retention: COURSE_DEFAULTS.retention, reviews, resolve: wordResolver(indexWords(part, lang), new Map()), notes: courseNotes(lang), notesRead: [], noteReads: [] });
}

// As of the day after the last answer.
const r = report(courses, end + DAY_MS);
console.log(process.argv.includes("--json") ? JSON.stringify(r, null, 2) : text(r));
