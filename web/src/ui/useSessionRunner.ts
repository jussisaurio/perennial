// A practice session's state, apart from how it looks: the planned runner, the
// card on screen, the active-time clock, what was answered (for Undo and the
// summary), and recording each answer as a review.

import { useCallback, useEffect, useRef, useState } from "react";
import { forgotLine } from "../content/voice";
import { language } from "../content/languages";
import { ActiveClock } from "../core/clock";
import type { Grade } from "../core/fsrs";
import { plantStage, readMemory, type PlantStage } from "../core/memory";
import { Session as Runner, type Task } from "../core/session";
import { recordReview, undoReview, useLearner, useStore, type Learner, type Sentence, type Word } from "../data/learner";
import { hash32 } from "../lib/seed";
import { hasVoice, isSoundOn, stopSpeaking } from "./speech";
import { wakeAudio } from "./chime";
import { sessionPlan } from "../data/practice";
import { growthOn, type GrowthMoment, type PlantLook } from "./Growth";
import { GARDEN_VISITOR_ART, type PixelArt } from "../garden/visitorArt";
import { VISITORS } from "../garden/visitors";
import { broughtVisitor } from "./visitors";

export interface Card {
  task: Task;
  word: Word;
  example?: Sentence;
  /** Reading-memory stability and the word's plant stage, for its plant. */
  s: number;
  stage: PlantStage;
}

export type Ended = "time" | "empty" | "user";

/** Pick the sentence the learner has seen least, so no two reviews look the same. */
function chooseExample(l: Learner, wordId: string): Sentence | undefined {
  const examples = l.sentences(wordId);
  if (!examples.length) return undefined;
  const seen = new Map<string, number>();
  for (const r of l.reviewsByWord.get(wordId) ?? []) if (r.sentence_id) seen.set(r.sentence_id, (seen.get(r.sentence_id) ?? 0) + 1);
  const min = Math.min(...examples.map((e) => seen.get(e.id) ?? 0));
  const least = examples.filter((e) => (seen.get(e.id) ?? 0) === min);
  // Ties broken by the word and how often it was reviewed, not at random: the
  // next review still gets another sentence, and Undo brings back the same card.
  return least[hash32(`${wordId}:${l.reviewsByWord.get(wordId)?.length ?? 0}`) % least.length];
}

interface Feedback {
  /** A short note for a moment ("Undone."); `ms` for a longer one. */
  flash: (text: string, ms?: number) => void;
  /** A note is about the previous card: clear it when the next answer comes. */
  clearNote: () => void;
  /** The word's plant is planted or grows; the next card waits until this resolves. */
  grow: (m: GrowthMoment) => Promise<void>;
}

export function useSessionRunner({ lang, minutes, onExit, flash, clearNote, grow }: { lang: string; minutes: number; onExit: () => void } & Feedback) {
  const learner = useLearner(lang);
  // Answers update the learner live; reads in event handlers use the latest.
  const live = useRef(learner);
  live.current = learner;
  // An answer reaches the learner on a later render: whoever waits for that hears of each new learner.
  const learnerChanged = useRef(new Set<() => void>());
  useEffect(() => {
    for (const fn of learnerChanged.current) fn();
    learnerChanged.current.clear();
  }, [learner]);
  const store = useStore();
  const tag = language(lang).tag;
  const [runner, setRunner] = useState<Runner | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [done, setDone] = useState(false);
  // Active time only: paused while the tab is hidden or the learner is idle.
  const clock = useRef(new ActiveClock(Date.now()));
  const [active, setActive] = useState(0);
  const counts = useRef({ intros: 0, answers: 0 });
  const [ended, setEnded] = useState<Ended>("time");
  // Words answered this session, and the new words shown (a seed is planted once it has an answer).
  const practised = useRef(new Set<string>());
  const introduced = useRef(new Set<string>());
  /** Each word's plant as it looked before its first answer this chunk, for the summary's replay (#216). */
  const before = useRef(new Map<string, PlantLook>());
  // Time on a "New to me" card: it records no review, so its time rides on the word's
  // quick check. Otherwise "minutes today" misses it and the day looks unfinished.
  const introMs = useRef(new Map<string, number>());
  const shownAt = useRef(0);
  const serial = useRef(0);
  // One entry per card answered, so Undo can revert what that answer recorded.
  // Each entry keeps the card's word and sentence, so Undo shows exactly that card again.
  const [undoStack, setUndoStack] = useState<{ reviewId?: string; intro: boolean; practised?: string; wordId: string; example?: Sentence; carried?: number }[]>([]);

  const start = useCallback(
    async (mins: number) => {
      // No voice, or sound turned off: no listening exercises.
      const l = live.current;
      if (!l) return;
      const voice = isSoundOn() && (await hasVoice(tag));
      const p = sessionPlan(l, mins, voice, Date.now());
      const r = new Runner(p, mins * 60_000);
      // Each chunk is its own session: its own summary, and nothing to undo from the last one.
      counts.current = { intros: 0, answers: 0 };
      practised.current = new Set();
      introduced.current = new Set();
      before.current = new Map();
      introMs.current = new Map();
      setUndoStack([]);
      clock.current = new ActiveClock(Date.now());
      setActive(0);
      setRunner(r);
      setDone(false);
      await advance(r);
    },
    // `advance` reads only refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tag],
  );

  /** Show the next card. `again`: the card being undone, so it comes back with the same sentence. */
  const advance = async (r: Runner, again?: { wordId: string; example?: Sentence }) => {
    stopSpeaking();
    const now = clock.current.tick(Date.now());
    const task = r.next(now);
    if (!task) {
      setEnded(r.timeUp(now) ? "time" : "empty");
      setCard(null);
      setDone(true);
      return;
    }
    const l = live.current!;
    const word = l.words.get(task.wordId);
    if (!word) {
      // The word is gone (deleted on another device): pass over it, and keep it out of Undo.
      r.skip();
      return advance(r);
    }
    const example = again?.wordId === word.id ? again.example : chooseExample(l, word.id);
    const read = readMemory(l, word.id);
    shownAt.current = clock.current.elapsed;
    serial.current++;
    setDone(false);
    // A focused button from the last card would also receive Space/Enter.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setCard({ task, word, example, s: read?.reps ? read.s : 0, stage: plantStage(read) });
  };

  // Plan once, as soon as the learner has loaded. Later changes (every answer
  // updates the learner) must not replan a session that is under way.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !learner) return;
    started.current = true;
    void start(minutes);
  }, [learner, start, minutes]);
  useEffect(() => () => stopSpeaking(), []);

  useEffect(() => {
    const t = setInterval(() => setActive(clock.current.tick(Date.now())), 1000);
    const onInput = () => clock.current.input(Date.now());
    const onVisibility = () => clock.current.setVisible(document.visibilityState === "visible", Date.now());
    window.addEventListener("keydown", onInput);
    window.addEventListener("pointerdown", onInput);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener("pointerdown", onInput);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const busy = useRef(false);
  const finish = async (grade: Grade | null, opts: { alreadyKnown?: boolean } = {}) => {
    if (!runner || !card || busy.current) return;
    busy.current = true;
    // Still inside the answer's tap or key press: the only time Safari lets audio start.
    wakeAudio();
    clearNote();
    try {
      const moment = await record(runner, card, grade, opts);
      if (moment) await grow(moment);
      await advance(runner);
    } finally {
      busy.current = false;
    }
  };

  const undo = async () => {
    if (!runner || busy.current || !undoStack.length) return;
    busy.current = true;
    try {
      const last = undoStack[undoStack.length - 1];
      if (!runner.undo()) return;
      setUndoStack((s) => s.slice(0, -1));
      if (last.reviewId) undoReview(store, last.reviewId);
      if (!last.intro) counts.current.answers--;
      if (last.intro) {
        counts.current.intros--;
        introduced.current.delete(last.wordId);
      }
      if (last.practised) practised.current.delete(last.practised);
      // Undoing a quick check gives the intro's time back to the next one; undoing the intro drops it.
      if (last.carried !== undefined) introMs.current.set(last.wordId, last.carried);
      if (last.intro) introMs.current.delete(last.wordId);
      flash("Undone.");
      await advance(runner, last);
    } finally {
      busy.current = false;
    }
  };

  const exit = () => {
    // Leaving after doing something shows what you did, rather than vanishing.
    if (undoStack.length && !done) {
      stopSpeaking();
      setEnded("user");
      setCard(null);
      setDone(true);
    } else onExit();
  };

  /**
   * The word's reading memory once it has more than `reps` reviews, that is,
   * once the answer just given has reached the learner. It arrives within a
   * render or two; if not, undefined, and the moment is skipped rather than
   * holding up the next card.
   */
  const readAfter = async (wordId: string, reps: number) => {
    for (let i = 0; i < 3; i++) {
      const read = live.current ? readMemory(live.current, wordId) : undefined;
      if (read && read.reps > reps) return read;
      await new Promise<void>((resolve) => {
        learnerChanged.current.add(resolve);
        setTimeout(resolve, 150);
      });
    }
    return undefined;
  };

  /**
   * A garden word (#209) with a visitor: its first good answer brings the
   * visitor. Returns the art for the growth moment; the very first visitor of
   * all also gets one plain line, so the learner sees why it came.
   */
  const visitorArrives = (wordId: string, lemma: string): PixelArt | undefined => {
    const l = live.current;
    const garden = l?.deck.byId.get(wordId)?.garden;
    const art = garden && GARDEN_VISITOR_ART[garden];
    const def = garden && VISITORS.find((v) => v.garden === garden);
    if (!l || !art || !def) return undefined;
    // The first visitor of all: no other garden word with art has brought its visitor yet.
    const before = l.deck.words.some((w) => w.id !== wordId && w.garden && GARDEN_VISITOR_ART[w.garden] && broughtVisitor(l, w.id));
    if (!before) flash(`You learned ${lemma}. A ${def.gloss} came to see.`, 4000);
    return art;
  };

  /** Records the answer. Returns the plant's moment, if the answer plants or waters it. */
  const record = async (runner: Runner, card: Card, grade: Grade | null, opts: { alreadyKnown?: boolean }): Promise<GrowthMoment | null> => {
    const ms = Math.min(clock.current.tick(Date.now()) - shownAt.current, 60_000);
    const { task, word, example } = card;
    if (!before.current.has(word.id)) before.current.set(word.id, { s: card.s, stage: card.stage });
    if (task.kind === "intro") {
      counts.current.intros++;
      introduced.current.add(word.id);
      const reviewId = opts.alreadyKnown ? recordReview(store, { lang, word_id: word.id, skill: "read", grade: 4, kind: "known", duration_ms: Math.round(ms), sentence_id: null }) : undefined;
      if (!opts.alreadyKnown) introMs.current.set(word.id, ms);
      runner.report(task, { alreadyKnown: opts.alreadyKnown });
      // No note: the button already said what happens ("Back in about a week").
      setUndoStack((s) => [...s, { reviewId, intro: true, wordId: word.id, example }]);
      // "I knew it" starts the word: a garden word's visitor comes now.
      const visitor = opts.alreadyKnown ? visitorArrives(word.id, word.lemma) : undefined;
      if (!growthOn()) return null;
      const seed = { s: 0, stage: "seed" as const };
      if (!opts.alreadyKnown) return { word: word.lemma, from: seed, to: seed, planted: true };
      const read = await readAfter(word.id, 0);
      return read ? { word: word.lemma, from: seed, to: { s: read.s, stage: plantStage(read) }, planted: true, visitor } : null;
    } else if (grade) {
      counts.current.answers++;
      const fresh = !practised.current.has(word.id);
      practised.current.add(word.id);
      const carried = introMs.current.get(word.id);
      introMs.current.delete(word.id);
      // ?? 0: no read review yet (a new word's quick check).
      const repsBefore = (live.current && readMemory(live.current, word.id)?.reps) ?? 0;
      // Read before this answer is recorded: did the word already bring its visitor?
      const brought = !!live.current && broughtVisitor(live.current, word.id);
      // ?? 0: no intro for this word in this session.
      const reviewId = recordReview(store, { lang, word_id: word.id, skill: task.skill, grade, kind: "review", duration_ms: Math.round(ms + (carried ?? 0)), sentence_id: example?.id ?? null });
      const retry = runner.report(task, { grade });
      if (grade === 1) flash(forgotLine(retry));
      setUndoStack((s) => [...s, { reviewId, intro: false, practised: fresh ? word.id : undefined, wordId: word.id, example, carried }]);
      // Only reading memory grows the plant, and only a remembered word grows.
      if (grade < 3 || task.skill !== "read") return null;
      // The first good answer to a word (a wrong one earlier does not count): a garden word's visitor comes now.
      const visitor = brought ? undefined : visitorArrives(word.id, word.lemma);
      if (!growthOn()) return null;
      const read = await readAfter(word.id, repsBefore);
      return read ? { word: word.lemma, from: { s: card.s, stage: card.stage }, to: { s: read.s, stage: plantStage(read) }, planted: false, visitor } : null;
    } else {
      // Passed over without an answer ("Can't listen now"): nothing to undo, so
      // Undo steps back over this card to the last answer.
      runner.skip();
    }
    return null;
  };

  return {
    learner,
    tag,
    runner,
    card,
    done,
    active,
    ended,
    /** What this session did so far, for the summary. */
    counts: counts.current,
    practised: practised.current,
    before: before.current,
    introduced: introduced.current,
    /** Changes with every card shown, so each card mounts fresh. */
    serial: serial.current,
    canUndo: undoStack.length > 0,
    start,
    finish,
    undo,
    exit,
  };
}
