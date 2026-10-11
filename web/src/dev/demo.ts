// Dev-only demo data: an anonymous learner whose garden has a realistic
// 90-day review history over the deck, so the garden, progress and sessions
// can be tried without weeks of practice. Uploaded through the normal write API.

import { DAY_MS, replay, type Grade } from "../core/fsrs";
import { fsrs } from "../core/scheduler";
import { authClient, ensureUser } from "../data/auth";
import { loadDeck } from "../data/deck";
import { APP_VERSION } from "../version";

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function post(mutations: unknown[]) {
  const res = await fetch("/api/write", { method: "POST", headers: { "content-type": "application/json", "x-perennial-version": APP_VERSION }, body: JSON.stringify({ mutations }) });
  if (!res.ok) throw new Error(`demo upload failed: ${res.status} ${await res.text()}`);
}

/** A fresh anonymous learner with `count` words studied over `days` days. */
export async function seedDemo(lang: "es" | "de", count: number, days = 90): Promise<void> {
  await authClient.signOut().catch(() => {});
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
      const st = replay(fsrs, log, 0.9, `${w.id}:read`)!;
      ts = st.due + (st.due - ts) * r() * 0.3;
    }
  });
  for (let i = 0; i < mutations.length; i += 500) await post(mutations.slice(i, i + 500));
}

/** Throw the demo learner away (it is anonymous, so this deletes it). */
export async function removeDemo(): Promise<void> {
  await fetch("/api/account/delete", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
  await authClient.signOut().catch(() => {});
}
