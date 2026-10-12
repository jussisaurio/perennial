// Dev-only demo data: an anonymous learner whose garden has a realistic
// 90-day review history over the deck, so the garden, progress and sessions
// can be tried without weeks of practice. Uploaded through the normal write API.

import { DAY_MS } from "../core/day";
import { replay, type Grade } from "../core/fsrs";
import { fsrs } from "../core/scheduler";
import { currentUser, ensureUser, signOut } from "../data/auth";
import { loadDeck } from "../data/deck";
import { keepCourse } from "../data/device";
import { ApiError, postWrite } from "../data/http";
import { memKey } from "../core/memory";
import { COURSE_DEFAULTS } from "../data/rows";
import { DAILY_MINUTES } from "../data/practice";
import type { DeckLang } from "../deck/schema";
import { rng } from "../lib/seed";

async function post(mutations: unknown[]) {
  await postWrite(mutations).catch((e: unknown) => {
    throw new Error(`demo upload failed: ${e instanceof ApiError ? `${e.status} ${e.code}` : String(e)}`);
  });
}

const DAYS = 90;

/** A fresh anonymous learner with `count` words studied over the last `DAYS` days. The app opens on this course. */
export async function seedDemo(lang: DeckLang, count: number): Promise<void> {
  const before = await currentUser();
  await signOut();
  // signOut only warns when it fails: then this is still the old user, maybe a real account.
  if ((await ensureUser()).id === before?.id) throw new Error("sign-out failed, so the demo would write into the learner who is signed in");
  keepCourse(lang);
  const deck = await loadDeck(lang);
  const now = Date.now();
  const r = rng(count * 31 + DAYS);
  const mutations: unknown[] = [{ type: "course.upsert", row: { lang, minutes: DAILY_MINUTES } }];
  const words = deck.words.slice(0, count);
  // The server takes at most QUOTA.reviewsPerDay (5000) reviews a day; keep a
  // whole-deck demo under it with fewer reviews per word.
  const perWord = Math.min(40, Math.floor(4800 / Math.max(1, words.length)));
  words.forEach((w, i) => {
    // Common words were met first; the newest ones only in the last days.
    let ts = now - DAYS * DAY_MS * Math.pow(1 - i / Math.max(1, words.length), 1.3) + r() * DAY_MS * 0.5;
    ts = Math.min(ts, now - DAY_MS * 0.1 * r());
    // About 1 in 6 words stopped getting practice at some point.
    const stopAt = r() < 0.17 ? ts + (now - ts) * (0.3 + r() * 0.5) : now;
    const log: { ts: number; grade: Grade }[] = [];
    for (let n = 0; n < perWord && ts < stopAt; n++) {
      const x = r();
      const grade: Grade = x < 0.06 ? 1 : x < 0.16 ? 2 : x < 0.92 ? 3 : 4;
      log.push({ ts: Math.round(ts), grade });
      mutations.push({ type: "review.insert", row: { id: crypto.randomUUID(), lang, word_id: w.id, skill: "read", grade, kind: "review", reviewed_at: new Date(ts).toISOString(), duration_ms: 2500 + Math.round(r() * 5000) } });
      const st = replay(fsrs, log, COURSE_DEFAULTS.retention, memKey(w.id, "read"))!;
      ts = st.due + (st.due - ts) * r() * 0.3;
    }
  });
  for (let i = 0; i < mutations.length; i += 500) await post(mutations.slice(i, i + 500));
}

/** Throw the demo learner away. Only an anonymous one: a real account is never deleted here. */
export async function removeDemo(): Promise<void> {
  // Only a learner known to be anonymous: no session, or a failed session check, deletes nothing.
  if (!(await currentUser())?.anonymous) return console.warn("[demo] not signed in as a demo learner: nothing deleted");
  // If the delete fails, say so and sign out anyway: this device forgets the learner,
  // and a leftover anonymous row in a dev database does no harm.
  const res = await fetch("/api/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch((e: unknown) => e);
  if (!(res instanceof Response) || !res.ok) console.warn("[demo] could not delete the demo learner on the server:", res instanceof Response ? res.status : res);
  await signOut();
}
