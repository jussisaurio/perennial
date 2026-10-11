// Dev-only demo dataset: a course with a realistic review history, so the
// garden, progress and sessions can be tried without weeks of practice.
// Rows are written straight to IndexedDB, not to the op log, so demo data
// never syncs to a server.

import { DAY_MS, replay, type Grade } from "../core/fsrs";
import { db, recomputeCourse, scheduler, setMeta } from "../db/db";
import type { Course, Example, Lexeme, Review } from "../model";
import { DEMO_WORDS } from "./demo-words";

export const DEMO_PREFIX = "demo-";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const demoSize = (lang: "es" | "de") => DEMO_WORDS[lang].length;

/**
 * Replaces any earlier demo course for `lang` with one where `count` words
 * have been studied over `days` days. Most were reviewed on time; some were
 * dropped a while ago, so the garden has thirsty plants too.
 */
export async function seedDemo(lang: "es" | "de", count: number, days = 90): Promise<string> {
  const courseId = `${DEMO_PREFIX}${lang}`;
  await removeDemo(courseId);
  const now = Date.now();
  const r = rng(count * 31 + days);
  const words = DEMO_WORDS[lang];
  const course: Course = { id: courseId, lang, native: "English", minutes: 7, retention: 0.9, createdAt: now - days * DAY_MS };
  const lexemes: Lexeme[] = [];
  const examples: Example[] = [];
  const reviews: Review[] = [];

  words.forEach((w, i) => {
    const id = `${courseId}-${i}`;
    lexemes.push({ id, courseId, lemma: w.lemma, gloss: w.gloss, pos: w.pos, rank: i + 1, forms: [w.lemma.toLowerCase()], addedAt: course.createdAt });
    // A one-word "sentence" keeps sessions working without AI.
    examples.push({ id: `${id}-ex`, courseId, lexemeId: id, text: w.lemma, translation: w.gloss, cloze: w.lemma, source: "manual", createdAt: course.createdAt });
    if (i >= count) return; // the rest are seeds, not started yet

    // Common words were met first; the newest ones only in the last days.
    let ts = now - days * DAY_MS * Math.pow(1 - i / Math.max(1, count), 1.3) + r() * DAY_MS * 0.5;
    ts = Math.min(ts, now - DAY_MS * 0.1 * r());
    // About 1 in 6 words stopped getting practice at some point.
    const stopAt = r() < 0.17 ? ts + (now - ts) * (0.3 + r() * 0.5) : now;
    const log: Review[] = [];
    for (let n = 0; n < 40 && ts < stopAt; n++) {
      const x = r();
      const grade: Grade = x < 0.06 ? 1 : x < 0.16 ? 2 : x < 0.92 ? 3 : 4;
      log.push({ id: `${id}-r${n}`, courseId, lexemeId: id, skill: "read", grade, ts: Math.round(ts), ms: 2500 + Math.round(r() * 5000) });
      const st = replay(scheduler, log, course.retention, `${id}:read`)!;
      // Learners are often a little late.
      ts = st.due + (st.due - ts) * r() * 0.3;
    }
    reviews.push(...log);
  });

  await db.transaction("rw", [db.courses, db.lexemes, db.examples, db.reviews], async () => {
    await db.courses.put(course);
    await db.lexemes.bulkPut(lexemes);
    await db.examples.bulkPut(examples);
    await db.reviews.bulkPut(reviews);
  });
  await recomputeCourse(courseId);
  await setMeta("course", courseId);
  return courseId;
}

export async function removeDemo(courseId?: string): Promise<void> {
  const ids = courseId ? [courseId] : (await db.courses.toCollection().primaryKeys()).filter((id) => String(id).startsWith(DEMO_PREFIX));
  for (const id of ids) {
    await db.transaction("rw", [db.courses, db.lexemes, db.examples, db.reviews, db.memory], async () => {
      for (const t of [db.lexemes, db.examples, db.reviews, db.memory] as const) await t.where("courseId").equals(id).delete();
      await db.courses.delete(id);
    });
  }
}
