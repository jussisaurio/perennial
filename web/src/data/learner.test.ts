import { describe, expect, mock, test } from "bun:test";
import type { ChangeMessage } from "@tanstack/react-db";
import { DAY_MS } from "../core/day";
import { GARDEN_WORDS, ORCHARD_WORDS } from "../deck/schema";
import type { Grade } from "../core/fsrs";
import { rng } from "../lib/seed";
import type { LoadedDeck } from "./deck";
import type { Learner } from "./learner";
import type { CourseRow, ReviewRow, Skill } from "./rows";
import type { Store } from "./store";

// The decks load through Vite; this test brings its own.
mock.module("./deck", () => ({
  loadDeck: () => Promise.reject(new Error("no decks here")),
  loadedDeck: () => undefined,
  loadSentences: () => Promise.reject(new Error("no decks here")),
  loadedSentences: () => undefined,
}));
const { Learners } = await import("./learner");
const { sessionPlan, sessionPlanSteps } = await import("./practice");

/** A table that is ready at once, and sends the changes a test gives it. */
class Table<T extends object> {
  private listener: ((changes: ChangeMessage<T>[]) => void) | null = null;
  private readonly initial: ChangeMessage<T>[];
  constructor(initial: ChangeMessage<T>[] = []) {
    this.initial = initial;
  }
  subscribeChanges(cb: (changes: ChangeMessage<T>[]) => void) {
    this.listener = cb;
    cb(this.initial);
    return { unsubscribe() {} };
  }
  onFirstReady() {
    return () => {};
  }
  isReady() {
    return true;
  }
  send(changes: ChangeMessage<T>[]) {
    this.listener!(changes);
  }
}

const course: CourseRow = { user_id: "u", lang: "es", minutes: 5, retention: 0.9, door_open: false, created_at: "2026-01-01T00:00:00Z" };
// 60 deck words, one also known by an old id; reviews of w60 and up are for words a newer deck has (not shown here).
const deckWords = Array.from({ length: 60 }, (_, i) => ({ id: `w${i}`, lemma: `word${i}`, gloss: "", forms: [`word${i}`], rank: i }));
const byId = new Map<string, unknown>(deckWords.map((w) => [w.id, w]));
// Only what the learner reads of a deck.
const defaultDeck = { lang: "es", words: deckWords, byId, resolve: (id: string) => byId.get(id === "w3-old" ? "w3" : id) } as unknown as LoadedDeck;

/** A store with these reviews; the other tables are empty. */
function store(reviews: ReviewRow[]) {
  const review = new Table(reviews.map((r): ChangeMessage<ReviewRow> => ({ type: "insert", key: r.id, value: r })));
  const collections = { course: new Table([{ type: "insert", key: "es", value: course }]), review, word_state: new Table(), user_word: new Table(), user_sentence: new Table() };
  // Only the tables and onDispose are used by Learners.
  const s = { collections, onDispose() {} } as unknown as Store;
  return { learners: new Learners(s), review };
}

/** The first learner is built in slices: null until then, and then a notice. */
function built(learners: InstanceType<typeof Learners>, deck = defaultDeck): Promise<Learner> {
  return new Promise((done) => {
    const off = learners.subscribe(() => {
      const l = learners.get("es", deck);
      if (!l) return;
      off();
      done(l);
    });
  });
}

/** The learner of these reviews, built from scratch. */
async function fromScratch(reviews: ReviewRow[], deck = defaultDeck): Promise<Learner> {
  const { learners } = store(reviews);
  expect(learners.get("es", deck)).toBeNull();
  return built(learners, deck);
}

/** Everything a screen reads of the memory, to compare a learner kept up to date with one built from scratch. */
const view = (l: Learner) => ({
  memories: l.memories,
  memory: l.memory,
  studied: l.studied.map((w) => w.id),
  // Word by word, so in no set order.
  reviews: l.everyReview().toSorted((a, b) => a.id.localeCompare(b.id)),
  reviewsByWord: l.reviewsByWord,
  // From the start, from mid-day 200 (the live answers), and from a day with none yet.
  since: [0, 200.5, 400].map((day) => l.reviewsSince(Date.UTC(2026, 0, 1, 8) + day * DAY_MS).map((r) => r.id).sort()),
});

describe("Learners: one review at a time, the same as building it all again", () => {
  const random = rng(11);
  const t0 = Date.UTC(2026, 0, 1, 8);
  let n = 0;
  const review = (word: number, skill: Skill, day: number, grade: Grade = 3): ReviewRow => ({
    id: `r${n++}`,
    user_id: "u",
    lang: "es",
    word_id: word === 3 && random() < 0.5 ? "w3-old" : `w${word}`,
    skill,
    grade,
    kind: "review",
    reviewed_at: new Date(t0 + day * DAY_MS).toISOString(),
    duration_ms: 3000,
    sentence_id: null,
  });

  test("answers, changed answers and undos", async () => {
    // Months of practice on 30 words, so that listening and writing unlock.
    const rows: ReviewRow[] = [];
    for (let w = 0; w < 30; w++) for (let k = 0, day = w; k < 6; k++, day += 2 ** k) rows.push(review(w, k > 4 && w % 3 === 0 ? "listen" : "read", day));
    const live = store(rows.slice(0, -20));
    expect(live.learners.get("es", defaultDeck)).toBeNull();
    // Answers that arrive while the first build runs are taken in after it.
    const first = built(live.learners);
    live.review.send(rows.slice(-20).map((r): ChangeMessage<ReviewRow> => ({ type: "insert", key: r.id, value: r })));
    let l = await first;
    expect(view(l)).toEqual(view(await fromScratch(rows)));
    let day = 200;
    for (let step = 0; step < 300; step++) {
      const before = l;
      const pick = random();
      const word = Math.floor(random() * 64);
      const skill = (["read", "read", "listen", "write"] as const)[Math.floor(random() * 4)];
      if (pick < 0.6) {
        const r = review(word, skill, (day += random()), random() < 0.2 ? 1 : 3);
        live.review.send([{ type: "insert", key: r.id, value: r }]);
        rows.push(r);
      } else if (pick < 0.8) {
        // The server keeps another grade for an answer.
        const i = Math.floor(random() * rows.length);
        rows[i] = { ...rows[i], grade: rows[i].grade === 1 ? 3 : 1 };
        live.review.send([{ type: "update", key: rows[i].id, value: rows[i] }]);
      } else {
        // Undo: the newest answer goes.
        const r = rows.pop()!;
        live.review.send([{ type: "delete", key: r.id, value: r }]);
      }
      l = live.learners.get("es", defaultDeck)!;
      expect(view(l)).toEqual(view(await fromScratch(rows)));
      // The first review and the last before a time, as a walk of every review finds them.
      expect(view(l).reviews).toEqual(rows.toSorted((a, b) => a.id.localeCompare(b.id)));
      const times = rows.map((r) => Date.parse(r.reviewed_at));
      expect(l.firstReviewAt()).toBe(Math.min(...times));
      for (const t of [t0, t0 + 1, t0 + 37.3 * DAY_MS, t0 + day * DAY_MS, t0 + (day + 0.01) * DAY_MS, t0 + 900 * DAY_MS]) {
        const before = times.filter((x) => x < t);
        expect(l.lastReviewBefore(t)).toBe(before.length ? Math.max(...before) : null);
      }
      for (const m of l.memories) expect(l.memory.get(m.key)).toBe(m);
      // A row that did not change is the same object, so screens can skip it.
      const changed = new Set(rows.slice(-1).map((r) => (r.word_id === "w3-old" ? "w3" : r.word_id)));
      if (pick < 0.6) for (const [key, m] of before.memory) if (!changed.has(m.wordId)) expect(l.memory.get(key)).toBe(m);
    }
  });
});

describe("upcoming(): one answer at a time, the same as working it out again", () => {
  // A longer course, with garden and orchard words at their places.
  const random = rng(7);
  const placed = new Map([...GARDEN_WORDS, ...ORCHARD_WORDS].map((name) => [Math.floor(random() * 400), name] as const));
  const words = Array.from({ length: 400 }, (_, i) => {
    const name = placed.get(i);
    const place = name === undefined ? {} : (GARDEN_WORDS as readonly string[]).includes(name) ? { garden: name } : { orchard: name };
    return { id: `w${i}`, lemma: `word${i}`, gloss: "", forms: [`word${i}`], rank: i, pos: (["noun", "verb", "adj", "prep"] as const)[i % 4], ...place };
  });
  const byId = new Map<string, unknown>(words.map((w) => [w.id, w]));
  const deck = { lang: "es", words, byId, resolve: (id: string) => byId.get(id) } as unknown as LoadedDeck;
  const t0 = Date.UTC(2026, 0, 1, 8);
  let n = 0;
  const review = (word: string, t: number): ReviewRow => ({ id: `u${n++}`, user_id: "u", lang: "es", word_id: word, skill: "read", grade: 3, kind: "review", reviewed_at: new Date(t0 + t * DAY_MS).toISOString(), duration_ms: 3000, sentence_id: null });

  test("starting words, answers anywhere, moved times and undos", async () => {
    const rows: ReviewRow[] = [];
    const live = store(rows);
    expect(live.learners.get("es", deck)).toBeNull();
    let l = await built(live.learners, deck);
    let t = 0;
    for (let step = 0; step < 600; step++) {
      const pick = random();
      const next = l.fresh();
      if (pick < 0.65 || !rows.length) {
        // Mostly one of the next words, as a session starts them; sometimes any word, ahead in the course or again.
        const r = review(random() < 0.5 && next.length ? next[Math.floor(random() * Math.min(3, next.length))] : `w${Math.floor(random() * 400)}`, (t += random()));
        live.review.send([{ type: "insert", key: r.id, value: r }]);
        rows.push(r);
      } else if (pick < 0.75) {
        // A review moves in time: a word's first review can change.
        const i = Math.floor(random() * rows.length);
        rows[i] = { ...rows[i], reviewed_at: new Date(t0 + random() * t * DAY_MS).toISOString() };
        live.review.send([{ type: "update", key: rows[i].id, value: rows[i] }]);
      } else {
        const r = rows.pop()!;
        live.review.send([{ type: "delete", key: r.id, value: r }]);
      }
      l = live.learners.get("es", deck)!;
      expect(l.fresh()).toEqual((await fromScratch(rows, deck)).fresh());
    }
  });

  test("Today's plan in slices is the session's plan, with a one-shot plan asked in between", async () => {
    const now = t0 + 40 * DAY_MS;
    const rows = Array.from({ length: 150 }, (_, i) => review(`w${(i * 7) % 400}`, i / 5));
    const l = await fromScratch(rows, deck);
    const steps = sessionPlanSteps(l, 5, true, now);
    for (let i = 0; i < 50; i++) expect(steps.next().done).toBe(false);
    // A render that asks before the slices are done works it all out at once.
    const oneShot = sessionPlan(l, 5, true, now);
    let s = steps.next();
    while (!s.done) s = steps.next();
    expect(s.value).toEqual(oneShot);
    expect(oneShot).toEqual(sessionPlan(await fromScratch(rows, deck), 5, true, now));
    expect(oneShot.queue.length).toBeGreaterThan(0);
  });
});
