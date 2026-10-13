// The learner model: the static deck plus the learner's synced rows, and what
// follows from them. Memory (FSRS stability, due dates, unlocks) is derived
// from the review log (core/memory.ts); nothing derived is stored or synced.

import { teachable } from "../content/languages";
import { courseOrder, nextWords, sinceGarden } from "../content/order";
import { useLiveQuery } from "@tanstack/react-db";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { deriveMemory, type MemoryRow } from "../core/memory";
import { loadDeck, type LoadedDeck } from "./deck";
import { postWrite } from "./http";
import { DAILY_MINUTES } from "./practice";
import { COURSE_DEFAULTS, type CourseRow, type ReviewRow, type UserSentenceRow, type UserWordRow, type WordStateRow } from "./rows";
import type { Store } from "./store";

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

// ---------- the store in React ----------

export const StoreContext = createContext<Store | null>(null);

/** The signed-in learner's store. Only use under a StoreContext provider. */
export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore outside a store");
  return s;
}

/** A language's deck (null while it loads), and whether it could not load at all (no saved copy either). */
export function useDeck(lang: string | undefined): { deck: LoadedDeck | null; failed: boolean } {
  const [deck, setDeck] = useState<LoadedDeck | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!lang) return;
    let alive = true;
    loadDeck(lang).then(
      (d) => {
        if (!alive) return;
        setDeck(d);
        setFailed(null);
      },
      // Logged once, where it fails (loadDeck).
      () => alive && setFailed(lang),
    );
    return () => {
      alive = false;
    };
  }, [lang]);
  return { deck: deck?.lang === lang ? deck : null, failed: !!lang && failed === lang };
}

/** The learner's courses, and whether they have loaded: "none yet" is not "none". */
export function useCourses(): { courses: CourseRow[]; ready: boolean } {
  const store = useStore();
  const { data, isReady } = useLiveQuery((q) => q.from({ c: store.collections.course }));
  return { courses: teachable((data ?? []) as CourseRow[]), ready: isReady };
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
  /** Words a session can introduce next, best first: picked words, then the course (content/order.ts). */
  upcoming(): Word[];
  /** The ids of upcoming(). */
  fresh(): string[];
  /** Resolve deck aliases to the word that counts. */
  resolve(id: string): string;
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
  // A deck that fails to load leaves this null: the app shows that error (Main in App.tsx).
  const { deck } = useDeck(lang);
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
    // Every started word has reviews: memories come from them.
    const firstReview = (id: string) => Math.min(...reviewsByWord.get(id)!.map((r) => Date.parse(r.reviewed_at)));
    // Sessions and the Words list's "New" both read this one order.
    const upcoming = () => {
      const open = (w: Word) => !started.has(w.id) && w.status !== "ignored" && w.status !== "paused" && sentences(w.id).length > 0;
      const picked = [...words.values()]
        .filter((w) => open(w) && (w.status === "queued" || w.source === "user"))
        .sort((a, b) => (stateMap.get(a.id)?.queued_at ?? "").localeCompare(stateMap.get(b.id)?.queued_at ?? "") || a.rank - b.rank);
      const pickedIds = new Set(picked.map((w) => w.id));
      // Garden words keep their spacing from one session to the next.
      const since = sinceGarden([...started].map((id) => ({ garden: deck.byId.get(id)?.garden, first: firstReview(id) })));
      // Your own choices first, as you made them; then the course, kinds of words taking turns (content/order.ts).
      const course = nextWords(courseOrder(deck), (w) => open(words.get(w.id)!) && !pickedIds.has(w.id), since);
      return [...picked, ...course.map((w) => words.get(w.id)!)];
    };
    const fresh = () => upcoming().map((w) => w.id);
    return { lang, deck, course, words, studied, memories, memory, reviews: langReviews, reviewsByWord, states: stateMap, sentences, upcoming, fresh, resolve };
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

export function saveCourse(store: Store, lang: string, patch: Partial<Pick<CourseRow, "retention">>) {
  const c = store.collections.course;
  return store.write(() => {
    if (c.has(lang))
      c.update(lang, (d) => {
        Object.assign(d, patch);
      });
    // The app no longer reads `minutes` (5 a day for everyone); older app versions still do.
    else c.insert({ user_id: store.userId, lang, minutes: DAILY_MINUTES, retention: patch.retention ?? COURSE_DEFAULTS.retention, created_at: new Date().toISOString() } as CourseRow & Record<string, unknown>);
  });
}
