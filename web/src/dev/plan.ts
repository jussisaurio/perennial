// The demo learner's made-up review history. The server makes it and writes it
// (server/src/demo.ts, #784). Pure: the same words, size and `now` give the same reviews.

import { DAY_MS } from "../core/day";
import { replay, type Grade } from "../core/fsrs";
import { fsrs } from "../core/scheduler";
import { memKey, wordState } from "../core/memory";
import { COURSE_DEFAULTS } from "../data/rows";
import { courseNotes } from "../garden/notes/read";
import { rng } from "../lib/seed";

/** How far back a demo of words studied goes. */
const DAYS = 90;
/** Words a story point's demo learner came to know a day, so its history is as long as a real one's: a word needs days between reviews to be known. */
const KNOWN_A_DAY = 4;

/** One studied word's made-up reviews, and whether they leave it known. */
interface WordPlan {
  wordId: string;
  log: { ts: number; grade: Grade; ms: number }[];
  known: boolean;
}

/**
 * Reviews over the last `days` days for each of `words`, the most common first.
 * `knewFirst`: see the grade below.
 */
function planWords(words: readonly { id: string }[], now: number, days: number, knewFirst: boolean): WordPlan[] {
  const r = rng(words.length * 31 + days);
  // Common words were met first; the newest ones only in the last days.
  // A story point's newest words were met two weeks ago at the latest: a word met
  // today can't be known yet, so with every deck word met, no deck could make
  // 90% of its words known (#882).
  const newest = knewFirst ? 14 / days : 0;
  const age = words.map((_, i) => Math.max(newest, Math.pow(1 - i / words.length, 1.3)));
  const totalAge = age.reduce((a, b) => a + b, 0);
  // The server takes at most QUOTA.reviewsPerDay (5000) reviews a day. Share
  // 4800 by age, as a real learner's reviews are: an even share gave a
  // 1600-word demo 3 reviews a word, so even "de" and "Tag" often stopped
  // after a lapse and showed as not known (#697). Each word gets at least 2.
  const reviews = age.map((a) => Math.min(40, 2 + Math.floor(((4800 - 2 * words.length) * a) / totalAge)));
  return words.map((w, i) => {
    // !: one each per word.
    const wordAge = age[i]!;
    const share = reviews[i]!;
    // Common words are easier: a quarter of the average lapses and hard answers for "de", 1.75 times for the rarest.
    const hard = 0.25 + (1.5 * i) / words.length;
    let ts = now - days * DAY_MS * wordAge + r() * DAY_MS * 0.5;
    ts = Math.min(ts, now - DAY_MS * 0.1 * r());
    // About 1 in 6 words stopped getting practice at some point.
    const stopAt = r() < 0.17 ? ts + (now - ts) * (0.3 + r() * 0.5) : now;
    const log: WordPlan["log"] = [];
    let known = false;
    for (let n = 0; n < share && ts < stopAt; n++) {
      const x = r();
      // A word the share leaves only 2 reviews is one a learner of this many words
      // often knew before: "I knew it" first. With "remembered", 2 reviews rarely
      // make a word known, and no deck had enough for the last note's 1600 (#751).
      // Only for a story point: in 90 days, "I knew it" puts the second review past
      // now for the newest words, so ?demo=es:800 knew 616 words, not 664.
      const grade: Grade = knewFirst && n === 0 && share === 2 ? 4 : x < 0.06 * hard ? 1 : x < 0.16 * hard ? 2 : x < 0.92 ? 3 : 4;
      log.push({ ts: Math.round(ts), grade, ms: 2500 + Math.round(r() * 5000) });
      const st = replay(fsrs, log, COURSE_DEFAULTS.retention, memKey(w.id, "read"))!;
      // As the app counts it from the same reviews (ui/visitors.ts knownWords).
      known = wordState(st) === "known";
      ts = st.due + (st.due - ts) * r() * 0.3;
    }
    return { wordId: w.id, log, known };
  });
}

/** How big the demo learner is: this many words studied, or exactly this many known (a story point, jumps.ts). */
export type DemoSize = { studied: number } | { known: number };

/** The words to upload reviews for, the most common first. @internal Exported for tests. */
export function planDemo(words: readonly { id: string }[], size: DemoSize, now: number): WordPlan[] {
  if ("studied" in size) return planWords(words.slice(0, size.studied), now, DAYS, false);
  const days = Math.max(DAYS, Math.ceil(size.known / KNOWN_A_DAY));
  // Some studied words are not known, so study more until enough are; then
  // leave out the newest known ones past the count, so the count is exact and
  // the next story point is not reached by chance.
  for (let n = size.known; ; ) {
    const plan = planWords(words.slice(0, n), now, days, true);
    const known = plan.filter((w) => w.known).length;
    if (known >= size.known) {
      let extra = known - size.known;
      return plan.reverse().filter((w) => !(w.known && extra-- > 0)).reverse();
    }
    if (n >= words.length) throw new Error(`the deck has too few words for ${size.known} known`);
    n = Math.min(words.length, n + Math.ceil((size.known - known) * 1.2));
  }
}

/** The demo learner's course: the gardener's notes read, and every review, oldest word first. */
export function demoHistory(lang: string, words: readonly { id: string }[], size: DemoSize, now: number) {
  // At a story point, the notes before it were read, as a learner who got there would have; its own is new.
  const notesRead = "known" in size ? courseNotes(lang).filter((n) => n.unlockAt < size.known).map((n) => n.id) : [];
  const reviews = planDemo(words, size, now).flatMap((w) => w.log.map((r) => ({ wordId: w.wordId, ...r })));
  return { notesRead, reviews };
}
