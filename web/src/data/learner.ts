// The learner model: the static deck plus the learner's synced rows, and what
// follows from them. Memory (FSRS stability, due dates, unlocks) is derived
// here from the review log; nothing derived is stored or synced.

import { courseOrder } from "../content/order";
import { useLiveQuery } from "@tanstack/react-db";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { DAY_MS, replay, type Grade } from "../core/fsrs";
import { fsrs } from "../core/scheduler";
import { loadDeck, type LoadedDeck } from "./deck";
import { postWrite } from "./http";
import type { CourseRow, ReviewRow, Skill, UserSentenceRow, UserWordRow, WordStateRow } from "./rows";
import type { Store } from "./store";

/** Harder skills unlock once reading is established (read stability in days). */
export const UNLOCK: Record<Exclude<Skill, "read">, number> = { listen: 4, write: 10 };
/** A word counts as known once its reading memory is stable for a week, recalled at least twice. */
export const KNOWN_STABILITY = 7;

export interface Sentence {
  id: string;
  text: string;
  translation: string;
  cloze: string;
  origin: "deck" | "own-text" | "ai";
  model?: string | null;
}

export interface Word {
  id: string;
  lemma: string;
  gloss: string;
  pos?: string | null;
  forms: string[];
  notes?: string | null;
  gender?: string;
  /** Frequency order for deck words; user words come after the deck. */
  rank: number;
  source: "deck" | "user";
  status: "active" | "paused" | "ignored" | "queued";
}

/** Derived from reviews; never stored or synced. `reps === 0` means unlocked but not yet practised. */
export interface MemoryRow {
  key: string; // `${wordId}:${skill}`
  wordId: string;
  skill: Skill;
  s: number;
  d: number;
  lastTs: number;
  due: number;
  reps: number;
  lapses: number;
}

export type WordState = "new" | "learning" | "known";

export function wordState(read: Pick<MemoryRow, "s" | "reps"> | undefined): WordState {
  if (!read || read.reps === 0) return "new";
  return read.s >= KNOWN_STABILITY && read.reps >= 2 ? "known" : "learning";
}

/** Read stability (days) at which a learning word shows a bud instead of a sprout. */
export const BUD_S = 3;
/** Read stability (days) of a word known for ages: its plant talks like an old-timer. */
export const OLD_S = 200;
export type PlantStage = "seed" | "sprout" | "bud" | "bloom";

/** A word's plant from its reading memory: the one definition every garden, list and card uses. It blooms exactly when the word is known. */
export function plantStage(read: Pick<MemoryRow, "s" | "reps"> | undefined): PlantStage {
  const st = wordState(read);
  return st === "new" ? "seed" : st === "known" ? "bloom" : read!.s >= BUD_S ? "bud" : "sprout";
}

/** A listening or writing memory strong enough for its dot on the plant: known by the same rule as reading. */
export const isStrong = (m: Pick<MemoryRow, "s" | "reps"> | undefined): boolean => wordState(m) === "known";

export function recall(m: MemoryRow, now = Date.now()): number {
  return m.reps ? fsrs.retrievability((now - m.lastTs) / DAY_MS, m.s) : 0;
}

export const memKey = (wordId: string, skill: Skill) => `${wordId}:${skill}`;

/** A word's reading memory, which decides its state and its plant. */
export function readMemory<M>(l: { memory: { get: (key: string) => M | undefined } }, wordId: string): M | undefined {
  return l.memory.get(memKey(wordId, "read"));
}

// ---------- the store in React ----------

export const StoreContext = createContext<Store | null>(null);

/** The signed-in learner's store. Only use under a StoreContext provider. */
export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore outside a store");
  return s;
}

export function useDeck(lang: string | undefined): LoadedDeck | null {
  const [deck, setDeck] = useState<LoadedDeck | null>(null);
  useEffect(() => {
    if (!lang) return;
    let alive = true;
    void loadDeck(lang).then((d) => alive && setDeck(d));
    return () => {
      alive = false;
    };
  }, [lang]);
  return deck?.lang === lang ? deck : null;
}

/** The learner's courses, and whether they have loaded: "none yet" is not "none". */
export function useCourses(): { courses: CourseRow[]; ready: boolean } {
  const store = useStore();
  const { data, isReady } = useLiveQuery((q) => q.from({ c: store.collections.course }));
  return { courses: (data ?? []) as CourseRow[], ready: isReady };
}

// ---------- derivation ----------

export interface Learner {
  lang: string;
  deck: LoadedDeck;
  course: CourseRow;
  words: Map<string, Word>;
  /** Words with any progress, or added by the learner. */
  studied: Word[];
  memories: MemoryRow[];
  memory: Map<string, MemoryRow>;
  reviews: ReviewRow[];
  reviewsByWord: Map<string, ReviewRow[]>;
  states: Map<string, WordStateRow>;
  sentences(wordId: string): Sentence[];
  /** Words not started yet, best first: picked words, then the deck in frequency order. */
  fresh(): string[];
  /** Resolve deck aliases to the word that counts. */
  resolve(id: string): string;
}

/** Fold reviews into memory rows per word and skill, plus unlocked-but-unpractised skills. */
export function deriveMemory(reviews: ReviewRow[], retention: number, resolve: (id: string) => string): MemoryRow[] {
  const groups = new Map<string, { wordId: string; skill: Skill; list: { ts: number; grade: Grade }[] }>();
  for (const r of reviews) {
    const wordId = resolve(r.word_id);
    const key = memKey(wordId, r.skill);
    const g = groups.get(key) ?? { wordId, skill: r.skill, list: [] };
    g.list.push({ ts: Date.parse(r.reviewed_at), grade: r.grade });
    groups.set(key, g);
  }
  const rows: MemoryRow[] = [];
  const read = new Map<string, MemoryRow>();
  for (const [key, g] of groups) {
    const st = replay(fsrs, g.list, retention, key);
    if (!st) continue;
    const row: MemoryRow = { key, wordId: g.wordId, skill: g.skill, ...st };
    rows.push(row);
    if (g.skill === "read") read.set(g.wordId, row);
  }
  // Harder skills unlock once reading is genuinely established, not after one lucky review.
  for (const [wordId, r] of read) {
    if (r.reps < 2) continue;
    for (const skill of ["listen", "write"] as const) {
      if (r.s >= UNLOCK[skill] && !groups.has(memKey(wordId, skill))) {
        rows.push({ key: memKey(wordId, skill), wordId, skill, s: 0, d: 0, lastTs: r.lastTs, due: r.lastTs, reps: 0, lapses: 0 });
      }
    }
  }
  return rows;
}

const userWordToWord = (u: UserWordRow, i: number, status: Word["status"]): Word => ({
  id: u.id,
  lemma: u.lemma,
  gloss: u.gloss,
  pos: u.pos,
  forms: u.forms?.length ? u.forms : [u.lemma.toLowerCase()],
  notes: u.notes,
  rank: 1_000_000 + i,
  source: "user",
  status,
});

/** Everything the screens need about one language, kept live. Null while loading. */
export function useLearner(lang: string | undefined): Learner | null {
  const store = useStore();
  const deck = useDeck(lang);
  const c = store.collections;
  const { data: courses, isReady: r1 } = useLiveQuery((q) => q.from({ c: c.course }));
  const { data: reviews, isReady: r2 } = useLiveQuery((q) => q.from({ r: c.review }));
  const { data: states, isReady: r3 } = useLiveQuery((q) => q.from({ s: c.word_state }));
  const { data: userWords, isReady: r4 } = useLiveQuery((q) => q.from({ w: c.user_word }));
  const { data: userSentences, isReady: r5 } = useLiveQuery((q) => q.from({ s: c.user_sentence }));
  // Until every table has its first data, a half-loaded learner would look like a fresh one.
  const ready = r1 && r2 && r3 && r4 && r5;

  return useMemo(() => {
    const course = (courses as CourseRow[] | undefined)?.find((x) => x.lang === lang);
    if (!ready || !deck || !course || !lang) return null;
    const stateMap = new Map((states as WordStateRow[] | undefined ?? []).map((s) => [s.word_id, s]));
    const statusOf = (id: string): Word["status"] => (stateMap.get(id)?.status as Word["status"]) ?? "active";

    const words = new Map<string, Word>();
    for (const w of deck.byId.values()) {
      if (w.retired || w.aliasOf) continue;
      words.set(w.id, { id: w.id, lemma: w.lemma, gloss: w.gloss, pos: w.pos, forms: w.forms, notes: w.notes, gender: w.gender, rank: w.rank, source: "deck", status: statusOf(w.id) });
    }
    const mine = ((userWords as UserWordRow[] | undefined) ?? []).filter((u) => u.lang === lang).sort((a, b) => a.created_at.localeCompare(b.created_at));
    mine.forEach((u, i) => {
      // A word a later deck also has is the deck's word: one plant, not two.
      if (u.deck_id && words.has(u.deck_id)) return;
      words.set(u.id, userWordToWord(u, i, statusOf(u.id)));
    });

    const resolve = (id: string) => deck.resolve(id)?.id ?? mine.find((u) => u.id === id && u.deck_id)?.deck_id ?? id;
    const langReviews = ((reviews as ReviewRow[] | undefined) ?? []).filter((r) => r.lang === lang);
    const reviewsByWord = new Map<string, ReviewRow[]>();
    for (const r of langReviews) {
      const id = resolve(r.word_id);
      reviewsByWord.set(id, [...(reviewsByWord.get(id) ?? []), r]);
    }
    // Reviews for words this build doesn't know (a newer deck on another device) are kept, not shown.
    const memories = deriveMemory(langReviews, course.retention, resolve).filter((m) => words.has(m.wordId));
    const memory = new Map(memories.map((m) => [m.key, m]));

    const sentencesBy = new Map<string, Sentence[]>();
    for (const s of (userSentences as UserSentenceRow[] | undefined) ?? []) {
      const id = resolve(s.word_id);
      sentencesBy.set(id, [...(sentencesBy.get(id) ?? []), { id: s.id, text: s.text, translation: s.translation, cloze: s.cloze, origin: s.origin, model: s.model }]);
    }
    const sentences = (wordId: string): Sentence[] => [
      ...(deck.sentencesByWord.get(wordId) ?? []).map((s) => ({ id: s.id, text: s.text, translation: s.translation, cloze: s.cloze, origin: "deck" as const })),
      ...(sentencesBy.get(wordId) ?? []),
    ];

    const started = new Set(memories.map((m) => m.wordId));
    const studied = [...words.values()].filter((w) => started.has(w.id) || w.source === "user" || w.status === "queued" || w.status === "paused");
    const fresh = () => {
      const open = (w: Word) => !started.has(w.id) && w.status !== "ignored" && w.status !== "paused" && sentences(w.id).length > 0;
      const picked = [...words.values()]
        .filter((w) => open(w) && (w.status === "queued" || w.source === "user"))
        .sort((a, b) => (stateMap.get(a.id)?.queued_at ?? "").localeCompare(stateMap.get(b.id)?.queued_at ?? "") || a.rank - b.rank);
      const pickedIds = new Set(picked.map((w) => w.id));
      // Your own choices first, as you made them; then the course, kinds of words taking turns (content/order.ts).
      const course = courseOrder(deck).filter((w) => open(words.get(w.id)!) && !pickedIds.has(w.id));
      return [...picked.map((w) => w.id), ...course.map((w) => w.id)];
    };
    return { lang, deck, course, words, studied, memories, memory, reviews: langReviews, reviewsByWord, states: stateMap, sentences, fresh, resolve };
  }, [ready, deck, courses, reviews, states, userWords, userSentences, lang]);
}

// ---------- writes ----------

export function recordReview(store: Store, r: Omit<ReviewRow, "id" | "user_id" | "reviewed_at"> & { reviewed_at?: string }): string {
  const id = crypto.randomUUID();
  const row: ReviewRow = { ...r, id, user_id: store.userId, reviewed_at: r.reviewed_at ?? new Date().toISOString() };
  void store.write(() => store.collections.review.insert(row as ReviewRow & Record<string, unknown>)).catch((e) => console.error("review not saved", e));
  return id;
}

export function undoReview(store: Store, id: string) {
  if (store.collections.review.has(id)) {
    void store.write(() => store.collections.review.delete(id)).catch((e) => console.error("undo not saved", e));
    return;
  }
  // Saved, but not back through sync yet (its echo can be slow): there is no
  // row to delete here, so ask the server directly. Its delete syncs back.
  if (!store.isWriter()) return;
  void postWrite([{ type: "review.delete", id }]).catch((e) => console.error("undo not saved", e));
}

export function setWordStatus(store: Store, wordId: string, status: Word["status"]) {
  const c = store.collections.word_state;
  const now = new Date().toISOString();
  return store.write(() => {
    if (status === "active") {
      if (c.has(wordId)) c.delete(wordId);
    } else if (c.has(wordId)) {
      c.update(wordId, (d) => {
        d.status = status;
        d.updated_at = now;
        if (status === "queued") d.queued_at = now;
      });
    } else {
      c.insert({ user_id: store.userId, word_id: wordId, status, queued_at: status === "queued" ? now : null, updated_at: now } as WordStateRow & Record<string, unknown>);
    }
  });
}

export function saveCourse(store: Store, lang: string, patch: Partial<Pick<CourseRow, "minutes" | "retention">>) {
  const c = store.collections.course;
  return store.write(() => {
    if (c.has(lang))
      c.update(lang, (d) => {
        Object.assign(d, patch);
      });
    else c.insert({ user_id: store.userId, lang, minutes: patch.minutes ?? 7, retention: patch.retention ?? 0.9, created_at: new Date().toISOString() } as CourseRow & Record<string, unknown>);
  });
}
