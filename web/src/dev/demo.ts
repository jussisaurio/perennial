// Dev-only demo data: an anonymous learner whose garden has a realistic
// 90-day review history over the deck, so the garden, progress and sessions
// can be tried without weeks of practice. Uploaded through the normal write API.

import { DAY_MS } from "../core/day";
import { replay, type Grade } from "../core/fsrs";
import { fsrs } from "../core/scheduler";
import { ensureUser, signOut } from "../data/auth";
import { loadDeck } from "../data/deck";
import { ApiError, postWrite } from "../data/http";
import { memKey } from "../core/memory";
import { COURSE_DEFAULTS } from "../data/rows";
import type { DeckLang } from "../deck/schema";
import { rng } from "../lib/seed";

async function post(mutations: unknown[]) {
  await postWrite(mutations).catch((e: unknown) => {
    throw new Error(`demo upload failed: ${e instanceof ApiError ? `${e.status} ${e.code}` : String(e)}`);
  });
}

/** A fresh anonymous learner with `count` words studied over `days` days. */
export async function seedDemo(lang: DeckLang, count: number, days = 90): Promise<void> {
  await signOut();
  await ensureUser();
  const deck = await loadDeck(lang);
  const now = Date.now();
  const r = rng(count * 31 + days);
  const mutations: unknown[] = [{ type: "course.upsert", row: { lang, minutes: 7 } }];
  const words = deck.words.slice(0, count);
  // The server takes at most QUOTA.reviewsPerDay (5000) reviews a day; keep a
  // whole-deck demo under it with fewer reviews per word.
  const perWord = Math.min(40, Math.floor(4800 / Math.max(1, words.length)));
  words.forEach((w, i) => {
    // Common words were met first; the newest ones only in the last days.
    let ts = now - days * DAY_MS * Math.pow(1 - i / Math.max(1, words.length), 1.3) + r() * DAY_MS * 0.5;
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

/** Throw the demo learner away (it is anonymous, so this deletes it). */
export async function removeDemo(): Promise<void> {
  await fetch("/api/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
  await signOut();
}
