// The learner model: the static deck plus the learner's synced rows, and what
// follows from them. Memory (FSRS stability, due dates, unlocks) is derived
// from the review log (core/memory.ts); nothing derived is stored or synced.

import { teachable } from "../content/languages";
import { courseOrder, placed, sinceLastPlaced, walkAgain, walkCourse, type Walk } from "../content/order";
import type { ChangeMessage } from "@tanstack/react-db";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { DAY_MS, startOfDay } from "../core/day";
import { firstReviewed, MemoryLog, reviewedAt, memKey, type MemoryRow } from "../core/memory";
import { loadDeck, loadedDeck, type LoadedDeck } from "./deck";
import { postWrite } from "./http";
import { inSlices, runAll } from "../lib/yield";
import { DAILY_MINUTES } from "./practice";
import { COURSE_DEFAULTS, SKILLS, type CourseRow, type ReviewRow, type UserSentenceRow, type UserWordRow, type WordStateRow } from "./rows";
import type { Store } from "./store";
import type { Gender, GardenWord, OrchardWord } from "../deck/schema";
import { NO_LEFT, type GardenLeft } from "perennial-contract";

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
  forms: readonly string[];
  notes?: string | null;
  gender?: Gender;
  /** Frequency order for deck words; user words come after the deck. */
  rank: number;
  source: "deck" | "user";
  status: "active" | "paused" | "ignored" | "queued";
  /** A garden word (#209): learning it brings this thing into the garden. */
  garden?: GardenWord;
  /** An orchard word (#315): learning it plants this tree in the orchard behind the hedge. */
  orchard?: OrchardWord;
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
  // Null: not loaded yet, so the effect below waits for it.
  const [deck, setDeck] = useState<LoadedDeck | null>(() => (lang ? (loadedDeck(lang) ?? null) : null));
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
  const source = useStore().learners;
  return useSyncExternalStore(source.subscribe, source.courseList);
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
  /** Every review of this language, word by word: made once per learner, when first asked (an export, a count), not on every answer (#486). */
  everyReview(): ReviewRow[];
  reviewsByWord: Map<string, ReviewRow[]>;
  /** The reviews made at or after `t` (ms), without a walk of every review: Today's plan and minutes read today's. */
  reviewsSince(t: number): ReviewRow[];
  /** The first review's time (ms), or null for none. Reads the first day's reviews only. */
  firstReviewAt(): number | null;
  /** The last review's time before `t` (ms), or null for none. Reads at most two days' reviews. */
  lastReviewBefore(t: number): number | null;
  states: Map<string, WordStateRow>;
  sentences(wordId: string): Sentence[];
  /** Words a session can introduce next, best first: picked words, then the course (content/order.ts). */
  upcoming(): Word[];
  /** The ids of upcoming(). */
  fresh(): string[];
  /** fresh(), a step at a time: Today works it out in slices (#569). */
  freshSteps(): Generator<void, string[]>;
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

/** Everything the screens need about one language, kept live. Null while loading. Every screen shares one (see Learners). */
export function useLearner(lang: string | undefined): Learner | null {
  const source = useStore().learners;
  // A deck that fails to load leaves this null: the app shows that error (Main in App.tsx).
  const { deck } = useDeck(lang);
  return useSyncExternalStore(source.subscribe, () => (lang && deck ? source.get(lang, deck) : null));
}

/** A table as its changes arrive: the rows in the collection's order, and a count of changes. */
class Mirror<T extends object> {
  readonly rows = new Map<string | number, T>();
  version = 0;
  apply(changes: readonly ChangeMessage<T>[]) {
    for (const c of changes) {
      if (c.type === "delete") this.rows.delete(c.key);
      else this.rows.set(c.key, c.value);
    }
    this.version++;
  }
}

/** The deck and the learner's own words: which word each id counts as. */
interface Links {
  deck: LoadedDeck;
  userWords: number;
  mine: UserWordRow[];
  resolve: (id: string) => string;
}

/** The words, with the learner's choices for them. */
interface Words {
  links: Links;
  states: number;
  stateMap: Map<string, WordStateRow>;
  words: Map<string, Word>;
}

/** One language's reviews, and the memory they make. */
interface Reviews {
  links: Links;
  log: MemoryLog;
  byWord: Map<string, ReviewRow[]>;
  /** The reviews by UTC day (dayOf), so reviewsSince reads only the last days. */
  byDay: Map<number, ReviewRow[]>;
}

/** A review's UTC day: unlike a local day, it stays right if the time zone changes. */
const dayOf = (r: ReviewRow) => Math.floor(reviewedAt(r) / DAY_MS);

/** A language's first build: what `get` goes on from, as it goes on from the build before. */
type First = Pick<Built, "reviews" | "words" | "memory">;

interface Built {
  words: Words;
  reviews: Reviews;
  sentences: { links: Links; version: number; byWord: Map<string, Sentence[]> };
  memory: Memory;
  learner: Learner;
  /** The learner's upcoming(), once asked: the next learner goes on from it. */
  upcoming: { state: Upcoming | null };
}

/**
 * The learners of one store, one per language, derived once and shared by
 * every screen. One subscription per table keeps them live. A new review
 * replays only its own word and skill (MemoryLog); a screen that opens again
 * gets the learner it had, with no work at all.
 */
export class Learners {
  private readonly listeners = new Set<() => void>();
  private readonly courses = new Mirror<CourseRow>();
  private readonly reviews = new Mirror<ReviewRow>();
  private readonly states = new Mirror<WordStateRow>();
  private readonly userWords = new Mirror<UserWordRow>();
  private readonly userSentences = new Mirror<UserSentenceRow>();
  private readonly built = new Map<string, Built>();
  /** Review changes each built language has not taken in yet, its own only. */
  private readonly pending = new Map<string, ChangeMessage<ReviewRow>[]>();
  /** Each language's first build of its reviews, words and memory: null while it runs (firstBuild). */
  private readonly first = new Map<string, First | null>();

  /** courseList's last answer, and the table it was made from. */
  private courseCache: { version: number; ready: boolean; list: { courses: CourseRow[]; ready: boolean } } | null = null;

  private readonly store: Pick<Store, "collections" | "onDispose">;

  /** Made with the store, before the rows arrive: they then come in a slice at a time, not all copied in one task at the first render (#447). */
  constructor(store: Pick<Store, "collections" | "onDispose">) {
    this.store = store;
    const c = store.collections;
    const follow = <T extends object>(collection: { subscribeChanges(cb: (changes: ChangeMessage<T>[]) => void, o: { includeInitialState: boolean }): { unsubscribe(): void }; onFirstReady(cb: () => void): () => void }, mirror: Mirror<T>, also?: (changes: ChangeMessage<T>[]) => void) => {
      const sub = collection.subscribeChanges(
        (changes) => {
          mirror.apply(changes);
          also?.(changes);
          this.notify();
        },
        { includeInitialState: true },
      );
      const off = collection.onFirstReady(() => this.notify());
      store.onDispose(() => {
        sub.unsubscribe();
        off();
      });
    };
    follow(c.course, this.courses);
    follow(c.review, this.reviews, (changes) => {
      for (const [lang, list] of this.pending) list.push(...changes.filter((c) => c.value.lang === lang));
    });
    follow(c.word_state, this.states);
    follow(c.user_word, this.userWords);
    follow(c.user_sentence, this.userSentences);
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };

  /** Whether `l` is its language's last built learner: only a new build changes the maps it shares (moreReviews, memoryOf). */
  isCurrent(l: Learner): boolean {
    return this.built.get(l.lang)?.learner === l;
  }

  /** The teachable courses, and whether they have loaded: "none yet" is not "none". The same object until either changes. */
  courseList = (): { courses: CourseRow[]; ready: boolean } => {
    const ready = this.store.collections.course.isReady();
    const last = this.courseCache;
    if (last && last.version === this.courses.version && last.ready === ready) return last.list;
    const list = { courses: teachable([...this.courses.rows.values()]), ready };
    this.courseCache = { version: this.courses.version, ready, list };
    return list;
  };

  private notify() {
    for (const l of this.listeners) l();
  }

  /** The learner for `lang`: the same object until something it reads changes. Null until every table has its first data. */
  get(lang: string, deck: LoadedDeck): Learner | null {
    const c = this.store.collections;
    // Until every table has its first data, a half-loaded learner would look like a fresh one.
    if (!(c.course.isReady() && c.review.isReady() && c.word_state.isReady() && c.user_word.isReady() && c.user_sentence.isReady())) return null;
    const course = this.courses.rows.get(lang);
    if (!course) return null;
    const prev = this.built.get(lang);
    // Later full builds (a new retention, a new word of the learner's) run at once: a loading screen would flash.
    const earlier = prev ?? this.firstBuild(lang, deck, course.retention);
    if (!earlier) return null;
    const base = earlier.reviews;
    // A built language's changes are listed from its first build on.
    const pending = this.pending.get(lang)!;
    const links = base.links.deck === deck && base.links.userWords === this.userWords.version ? base.links : this.links(lang, deck);
    const words = earlier.words.links === links && earlier.words.states === this.states.version ? earlier.words : this.words(links);
    const sentences = prev && prev.sentences.links === links && prev.sentences.version === this.userSentences.version ? prev.sentences : this.sentences(links);
    let reviews = base.links === links && base.log.retention === course.retention ? base : null;
    // moreReviews and memoryOf change the maps in place: what upcoming() needs from the learner before is read first.
    const changed = new Set(pending.map((c) => links.resolve(c.value.word_id)));
    const was = prev?.upcoming.state ? beforeOf(prev, changed) : null;
    if (reviews && pending.length) reviews = moreReviews(reviews, pending);
    reviews ??= runAll(allReviews(this.langReviews(lang), links, course.retention));
    this.pending.set(lang, []);
    if (prev && prev.learner.course === course && prev.words === words && prev.reviews === reviews && !pending.length && prev.sentences === sentences) return prev.learner;
    // The same reviews and words (the first build, with no answers since): the same memory, with no copy of its maps.
    const memory =
      earlier.reviews === reviews && earlier.words === words ? earlier.memory : memoryOf(reviews.log, words.words, earlier.reviews.log === reviews.log && earlier.words.words === words.words ? earlier.memory : undefined);
    // Only the reviews of these words changed since the learner before (moreReviews keeps the log): its upcoming() goes on from there.
    const from = prev && was && prev.words === words && prev.sentences === sentences && prev.reviews.log === reviews.log ? was : null;
    const upcoming = { state: null };
    const learner = assemble(lang, course, words, reviews, sentences.byWord, memory, from, upcoming);
    this.built.set(lang, { words, reviews, sentences, memory, learner, upcoming });
    this.first.delete(lang);
    return learner;
  }

  private links(lang: string, deck: LoadedDeck): Links {
    const mine = [...this.userWords.rows.values()].filter((u) => u.lang === lang).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const linked = new Map(mine.flatMap((u) => (u.deck_id ? [[u.id, u.deck_id] as const] : [])));
    return { deck, userWords: this.userWords.version, mine, resolve: (id) => deck.resolve(id)?.id ?? linked.get(id) ?? id };
  }

  private words(links: Links): Words {
    const stateMap = new Map([...this.states.rows.values()].map((s) => [s.word_id, s]));
    const statusOf = (id: string): Word["status"] => (stateMap.get(id)?.status as Word["status"]) ?? "active";
    const words = new Map<string, Word>();
    for (const w of links.deck.byId.values()) {
      if (w.retired || w.aliasOf) continue;
      words.set(w.id, { id: w.id, lemma: w.lemma, gloss: w.gloss, pos: w.pos, forms: w.forms, notes: w.notes, gender: w.gender, rank: w.rank, source: "deck", status: statusOf(w.id), garden: w.garden, orchard: w.orchard });
    }
    links.mine.forEach((u, i) => {
      // A word a later deck also has is the deck's word: one plant, not two.
      if (u.deck_id && words.has(u.deck_id)) return;
      words.set(u.id, userWordToWord(u, i, statusOf(u.id)));
    });
    return { links, states: this.states.version, stateMap, words };
  }

  private sentences(links: Links): Built["sentences"] {
    const byWord = new Map<string, Sentence[]>();
    for (const s of this.userSentences.rows.values()) {
      const id = links.resolve(s.word_id);
      const list = byWord.get(id) ?? [];
      list.push({ id: s.id, text: s.text, translation: s.translation, cloze: s.cloze, origin: s.origin, model: s.model });
      byWord.set(id, list);
    }
    return { links, version: this.userSentences.version, byWord };
  }

  /**
   * The first build of a language's reviews and memory, in slices (#486): a
   * year of reviews took 150 ms in one task at CPU 10×. Null until it is done,
   * so the screens show their loading state. Changes that arrive meanwhile
   * wait in `pending`, as for any built learner; `get` takes them in as it
   * does after any build.
   */
  private firstBuild(lang: string, deck: LoadedDeck, retention: number): First | null {
    const first = this.first.get(lang);
    if (first !== undefined) return first;
    this.first.set(lang, null);
    this.pending.set(lang, []);
    const links = this.links(lang, deck);
    const words = this.words(links);
    const rows = this.langReviews(lang);
    // The course order (~16 ms at CPU 10×, once per deck) is one step too: upcoming() reads it right after first paint.
    const steps = (function* (): Generator<void, First> {
      courseOrder(deck);
      yield;
      const reviews = yield* allReviews(rows, links, retention);
      // The memory map, started words and studied list: O(memories + words), so not in the first render either.
      return { reviews, words, memory: memoryOf(reviews.log, words.words, undefined) };
    })();
    void inSlices(steps).then((first) => {
      this.first.set(lang, first);
      this.notify();
    });
    return null;
  }

  private langReviews(lang: string): ReviewRow[] {
    return [...this.reviews.rows.values()].filter((r) => r.lang === lang);
  }
}

/** The log of all these reviews, a step at a time: run all at once, or in slices. */
function* allReviews(rows: readonly ReviewRow[], links: Links, retention: number): Generator<void, Reviews> {
  const log = new MemoryLog(retention, links.resolve);
  const byWord = new Map<string, ReviewRow[]>();
  const byDay = new Map<number, ReviewRow[]>();
  const add = <K>(map: Map<K, ReviewRow[]>, key: K, r: ReviewRow) => {
    const list = map.get(key);
    if (list) list.push(r);
    else map.set(key, [r]);
  };
  for (const r of rows) {
    log.set(r);
    add(byWord, links.resolve(r.word_id), r);
    add(byDay, dayOf(r), r);
    yield;
  }
  yield* log.building();
  return { links, log, byWord, byDay };
}

/** What upcoming() needs of `changed` words from the learner before, read before moreReviews and memoryOf change its maps. */
function beforeOf(prev: Built, changed: Set<string>): Before {
  const started = new Set([...changed].filter((id) => prev.memory.started.has(id)));
  // Every started word has reviews: memories come from them.
  const first = new Map([...started].map((id) => [id, firstReviewed(prev.reviews.byWord.get(id)!).any]));
  return { state: prev.upcoming.state!, started, first, changed };
}

/**
 * Take in review changes: only the words they touch change. Null when the log
 * must be built again (MemoryLog says when). The maps change in place, as the
 * log does: a copy of every word's entry per answer made a major GC every few
 * answers (#572). Each word's and day's list is still a new array when it
 * changes, so caches by list (firstReviewed) stay right.
 */
function moreReviews(prev: Reviews, changes: readonly ChangeMessage<ReviewRow>[]): Reviews | null {
  const { byWord, byDay } = prev;
  for (const { type, value: r } of changes) {
    const id = prev.links.resolve(r.word_id);
    const was = byWord.get(id) ?? [];
    // Out of its day first: a changed review can have a new time.
    const old = was.find((x) => x.id === r.id);
    if (old) {
      const left = byDay.get(dayOf(old))!.filter((x) => x.id !== r.id);
      if (left.length) byDay.set(dayOf(old), left);
      else byDay.delete(dayOf(old));
    }
    if (type !== "delete") byDay.set(dayOf(r), [...(byDay.get(dayOf(r)) ?? []), r]);
    if (type === "delete") {
      if (!prev.log.delete(r.id)) return null;
      const left = was.filter((x) => x.id !== r.id);
      if (left.length) byWord.set(id, left);
      else byWord.delete(id);
    } else {
      if (!prev.log.set(r)) return null;
      // A review changed in place keeps its place, as in the table.
      byWord.set(id, was.some((x) => x.id === r.id) ? was.map((x) => (x.id === r.id ? r : x)) : [...was, r]);
    }
  }
  return { ...prev };
}

/** What the review log says about the words: the log's rows, and the parts of the learner made from them. */
interface Memory {
  rows: MemoryRow[];
  memories: MemoryRow[];
  memory: Map<string, MemoryRow>;
  started: Set<string>;
  studied: Word[];
}

/**
 * The memory of `log` for `words`. With `prev`, the memory of the same log
 * and words just before, only the words the log changed since are worked out
 * again, and the rest is kept (#483), in `prev`'s own map and set (#572).
 * Equal to building it all again.
 */
function memoryOf(log: MemoryLog, words: Map<string, Word>, prev: Memory | undefined): Memory {
  const rows = log.rows();
  // Reviews for words this build doesn't know (a newer deck on another device) are kept, not shown.
  const shown = (wordId: string) => words.has(wordId);
  const studiedOf = (started: Set<string>) => [...words.values()].filter((w) => started.has(w.id) || w.source === "user" || w.status === "queued" || w.status === "paused");
  const all = (): MemoryRow[] => {
    const kept = rows.filter((m) => shown(m.wordId));
    return kept.length === rows.length ? rows : kept;
  };
  const touched = log.touched;
  if (!prev || !touched) {
    const memories = all();
    const started = new Set(memories.map((m) => m.wordId));
    return { rows, memories, memory: new Map(memories.map((m) => [m.key, m])), started, studied: studiedOf(started) };
  }
  const memories = prev.memories === prev.rows && [...touched].every(shown) ? rows : all();
  const { memory, started } = prev;
  let moved = false;
  for (const wordId of touched) {
    if (!shown(wordId)) continue;
    let any = false;
    for (const skill of SKILLS) {
      const key = memKey(wordId, skill);
      const row = log.get(key);
      if (row) memory.set(key, row);
      else memory.delete(key);
      any ||= !!row;
    }
    if (any !== started.has(wordId)) moved = true;
    if (any) started.add(wordId);
    else started.delete(wordId);
  }
  return { rows, memories, memory, started, studied: moved ? studiedOf(started) : prev.studied };
}

/** The learner itself, from its parts. */
function assemble(lang: string, course: CourseRow, wordsOf: Words, { byWord: reviewsByWord, byDay }: Reviews, sentencesBy: Map<string, Sentence[]>, { memories, memory, started, studied }: Memory, from: Before | null, box: { state: Upcoming | null }): Learner {
  const { words, stateMap, links } = wordsOf;
  const { deck, resolve } = links;
  const sentences = (wordId: string): Sentence[] => [
    ...(deck.sentencesByWord.get(wordId) ?? []).map((s) => ({ id: s.id, text: s.text, translation: s.translation, cloze: s.cloze, origin: "deck" as const })),
    ...(sentencesBy.get(wordId) ?? []),
  ];
  // Every list in these maps has at least one sentence.
  const hasSentences = (wordId: string) => deck.sentencesByWord.has(wordId) || sentencesBy.has(wordId);

  // Every started word has reviews: memories come from them.
  const firstReview = (id: string) => firstReviewed(reviewsByWord.get(id)!).any;
  // Sessions and the Words list's "New" both read this one order. Worked out once per learner, when first asked.
  // The learner before is let go once used: a chain of learners would hold every one's maps.
  let before = from;
  function* upcomingSteps(): Generator<void, Word[]> {
    if (!box.state) {
      const state = yield* upcomingOf(wordsOf, started, firstReview, hasSentences, before);
      // An upcoming() between two steps worked out an equal one: keep the first.
      box.state ??= state;
      before = null;
    }
    return box.state.next;
  }
  const upcoming = () => runAll(upcomingSteps());
  let ids: string[] | null = null;
  function* freshSteps(): Generator<void, string[]> {
    if (!ids) {
      const next = yield* upcomingSteps();
      ids ??= next.map((w) => w.id);
    }
    return ids;
  }
  const fresh = () => runAll(freshSteps());
  const reviewsSince = (t: number) => {
    const out: ReviewRow[] = [];
    for (const [day, list] of byDay) if (day >= Math.floor(t / DAY_MS)) for (const r of list) if (reviewedAt(r) >= t) out.push(r);
    return out;
  };
  let every: ReviewRow[] | null = null;
  const everyReview = () => (every ??= [...reviewsByWord.values()].flat());
  // A review on an earlier UTC day is earlier: only one day's reviews are read, and one more when none of the last day's is before `t`.
  const firstReviewAt = () => {
    let first: number | null = null;
    const day = Math.min(...byDay.keys());
    if (day !== Infinity) for (const r of byDay.get(day)!) if (first === null || reviewedAt(r) < first) first = reviewedAt(r);
    return first;
  };
  const lastReviewBefore = (t: number) => {
    for (let bound = Math.floor(t / DAY_MS); ; ) {
      let day = -Infinity;
      for (const d of byDay.keys()) if (d <= bound && d > day) day = d;
      if (day === -Infinity) return null;
      let last: number | null = null;
      for (const r of byDay.get(day)!) if (reviewedAt(r) < t && (last === null || reviewedAt(r) > last)) last = reviewedAt(r);
      if (last !== null) return last;
      bound = day - 1;
    }
  };
  return { lang, deck, course, words, studied, memories, memory, everyReview, reviewsByWord, reviewsSince, firstReviewAt, lastReviewBefore, states: stateMap, sentences, upcoming, fresh, freshSteps, resolve };
}

/** upcoming(): the words, and the walk of the course and `since` they came from. */
interface Upcoming {
  next: Word[];
  walk: Walk<Word>;
  /** sinceLastPlaced's `last`. */
  last: number;
}

/** The learner before, when only some words' reviews changed since (`changed`, a superset of them). */
interface Before {
  state: Upcoming;
  /** The `changed` words that were started. */
  started: Set<string>;
  /** Their first reviews. */
  first: Map<string, number>;
  changed: Set<string>;
}

/** The course as these words, each word's place in it, and the words you picked, in the order you picked them. Once per Words. */
const choicesOf = new WeakMap<Words, { course: Word[]; at: Map<string, number>; picked: Word[] }>();
function* choices(w: Words) {
  const known = choicesOf.get(w);
  if (known) return known;
  const course: Word[] = [];
  const at = new Map<string, number>();
  for (const d of courseOrder(w.links.deck)) {
    const x = w.words.get(d.id)!;
    at.set(x.id, course.length);
    course.push(x);
    yield;
  }
  const picked: Word[] = [];
  for (const x of w.words.values()) {
    if (isPicked(x)) picked.push(x);
    yield;
  }
  picked.sort((a, b) => (w.stateMap.get(a.id)?.queued_at ?? "").localeCompare(w.stateMap.get(b.id)?.queued_at ?? "") || a.rank - b.rank);
  // Steps of another walk may have made it meanwhile: an equal one.
  const c = choicesOf.get(w) ?? { course, at, picked };
  choicesOf.set(w, c);
  return c;
}

/** Your own choices: they come before the course. */
const isPicked = (w: Word) => w.status === "queued" || w.source === "user";

/**
 * The learner's upcoming(). With `from`, the learner before, only the words
 * whose start or first review moved are looked at again (walkAgain): O(those
 * words) plus a copy of the list, not O(course) (#486). Equal to working it
 * out from scratch.
 */
function* upcomingOf(words: Words, started: Set<string>, firstReview: (id: string) => number, hasSentences: (id: string) => boolean, from: Before | null): Generator<void, Upcoming> {
  const { course, at, picked } = yield* choices(words);
  const can = (w: Word) => w.status !== "ignored" && w.status !== "paused" && hasSentences(w.id);
  const open = (w: Word) => !started.has(w.id) && can(w);
  // Picked words are not in the course list too.
  const inCourse = (w: Word) => open(w) && !isPicked(w);
  const pick = (walk: Walk<Word>, last: number): Upcoming => ({ next: [...picked.filter(open), ...walk.list], walk, last });
  // Garden and orchard words keep their spacing from one session to the next. Your own words are not in the deck, so they count as other new words.
  function* fromScratch(): Generator<void, Upcoming> {
    const firsts = [];
    for (const id of started) {
      firsts.push({ ...placedOf(words.words.get(id)!), first: firstReview(id) });
      yield;
    }
    const { since, last } = sinceLastPlaced(firsts);
    yield;
    return pick(walkCourse(course, inCourse, since), last);
  }
  if (!from) return yield* fromScratch();
  const firstBefore = (id: string) => from.first.get(id)!;
  const moved = [...from.changed].filter((id) => from.started.has(id) !== started.has(id) || (started.has(id) && firstBefore(id) !== firstReview(id)));
  if (!moved.length) return from.state;
  // A garden or orchard word moved: its time is where `since` counts from.
  if (moved.some((id) => placed(words.words.get(id)!))) return yield* fromScratch();
  let since = from.state.walk.since;
  const { last } = from.state;
  for (const id of moved) {
    if (from.started.has(id) && firstBefore(id) > last) since--;
    if (started.has(id) && firstReview(id) > last) since++;
  }
  const wasInCourse = (w: Word) => !from.started.has(w.id) && can(w) && !isPicked(w);
  const changed = new Set(moved.flatMap((id) => (at.has(id) ? [at.get(id)!] : [])));
  return pick(walkAgain(from.state.walk, course, inCourse, wasInCourse, since, changed), last);
}

const placedOf = (w: Word) => ({ garden: w.garden, orchard: w.orchard });

/**
 * `derive(l, now)`, worked out once per learner and day: a screen that opens
 * again, or a second part that asks, gets it with no work. A learner is a new
 * object whenever its data changes, so it is never stale; within a day it
 * keeps the first `now`, as a screen's own memo for the day would.
 */
export function perLearnerDay<T>(derive: (l: Learner, now: number) => T): (l: Learner, now: number) => T {
  return dayCached(derive, new WeakMap());
}

type DayCache<T> = WeakMap<Learner, { day: number; value: T }>;

function dayCached<T>(derive: (l: Learner, now: number) => T, cache: DayCache<T>): (l: Learner, now: number) => T {
  return (l, now) => {
    const day = startOfDay(now);
    const hit = cache.get(l);
    if (hit?.day === day) return hit.value;
    const value = derive(l, now);
    cache.set(l, { day, value });
    return value;
  };
}

/**
 * perLearnerDay for work too long for one task: `warm` works it out in
 * slices, so a render that reads it later (`get`) does no work. A `get`
 * before that works it all out at once. `warm` stops, and keeps nothing,
 * once `live()` says `l` is no longer the current learner: an answer changes
 * its maps in place (moreReviews), so its slices would read a mix.
 */
export function slicedPerLearnerDay<T>(steps: (l: Learner, now: number) => Generator<void, T>): {
  get: (l: Learner, now: number) => T;
  warm: (l: Learner, now: number, live: () => boolean) => Promise<void>;
} {
  const cache: DayCache<T> = new WeakMap();
  return {
    get: dayCached((l, now) => runAll(steps(l, now)), cache),
    warm: async (l, now, live) => {
      const day = startOfDay(now);
      if (cache.get(l)?.day === day) return;
      const done = await inSlices(whileLive(steps(l, now), live));
      // A render may have asked meanwhile: keep the value it got, an equal one.
      if (done && cache.get(l)?.day !== day) cache.set(l, { day, value: done.value });
    },
  };
}

/** `steps`, stopped (null) when `live()` turns false between two of them. */
function* whileLive<T>(steps: Generator<void, T>, live: () => boolean): Generator<void, { value: T } | null> {
  for (;;) {
    const s = steps.next();
    if (s.done) return { value: s.value };
    yield;
    if (!live()) return null;
  }
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

/**
 * A friend's gifted seed (#213): queue the word, but only where the learner has
 * no say on it yet. The row is written as older than anything (updated_at at
 * the epoch), so the server keeps any row it already has: a "never show",
 * "pause" or queue the learner chose, even one this device has not synced yet
 * (#229). Returns false when this device already has a row for the word.
 */
export function plantGift(store: Store, wordId: string): Promise<boolean> {
  const c = store.collections.word_state;
  if (c.has(wordId)) return Promise.resolve(false);
  return store
    .write(() => {
      c.insert({ user_id: store.userId, word_id: wordId, status: "queued", queued_at: new Date().toISOString(), updated_at: new Date(0).toISOString() } as WordStateRow & Record<string, unknown>);
    })
    .then(() => true);
}

export function saveCourse(store: Store, lang: string, patch: Partial<Pick<CourseRow, "retention">>) {
  const c = store.collections.course;
  return store.write(() => {
    if (c.has(lang))
      c.update(lang, (d) => {
        Object.assign(d, patch);
      });
    // The app no longer reads `minutes` (5 a day for everyone); older app versions still do.
    else c.insert({ user_id: store.userId, lang, minutes: DAILY_MINUTES, retention: patch.retention ?? COURSE_DEFAULTS.retention, door_open: false, garden_left: NO_LEFT, created_at: new Date().toISOString() } as CourseRow & Record<string, unknown>);
  });
}

/**
 * Leave it out (#351): the garden's bowl and shelf changed. The server merges
 * it with what it has, so it only moves forward on every device (server/src/garden.ts).
 */
export function saveLeft(store: Store, lang: string, left: GardenLeft) {
  return store.write(() => {
    store.collections.course.update(lang, (d) => {
      // As saveCourse does: the draft's type wants mutable arrays, and the value is replaced whole, never edited in place.
      Object.assign(d, { garden_left: left });
    });
  });
}

/** The learner opened the garden's door with the key (#315). It stays open, on every device; the server never shuts it again. */
export function openDoor(store: Store, lang: string) {
  return store.write(() => {
    store.collections.course.update(lang, (d) => {
      d.door_open = true;
    });
  });
}
