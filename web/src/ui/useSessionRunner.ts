// A practice session's state, apart from how it looks: the planned runner, the
// card on screen, the active-time clock, what was answered (for Undo and the
// summary), and recording each answer as a review.

import { useCallback, useEffect, useRef, useState } from "react";
import { forgotLine } from "../content/voice";
import { language } from "../content/languages";
import { ActiveClock } from "../core/clock";
import type { Grade } from "../core/fsrs";
import { readMemory, wordState } from "../core/memory";
import { plan, Session as Runner, type Task } from "../core/session";
import { fsrs as scheduler } from "../core/scheduler";
import { recordReview, undoReview, useLearner, useStore, type Learner, type Sentence, type Word } from "../data/learner";
import { hash32 } from "../lib/seed";
import { hasVoice, isSoundOn, stopSpeaking } from "./speech";
import { newWordsToday } from "./stats";

export interface Card {
  task: Task;
  word: Word;
  example?: Sentence;
  /** Reading-memory stability and whether the word counts as known, for its plant. */
  s: number;
  known: boolean;
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
  /** A short note for a moment ("Undone."). */
  flash: (text: string) => void;
  /** A note is about the previous card: clear it when the next answer comes. */
  clearNote: () => void;
  /** The word's own plant pops up and grows. */
  pop: (word: string, s: number, known: boolean) => void;
}

export function useSessionRunner({ lang, minutes, onExit, flash, clearNote, pop }: { lang: string; minutes: number; onExit: () => void } & Feedback) {
  const learner = useLearner(lang);
  // Answers update the learner live; reads in event handlers use the latest.
  const live = useRef(learner);
  live.current = learner;
  const store = useStore();
  const tag = language(lang).tag;
  const [runner, setRunner] = useState<Runner | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [done, setDone] = useState(false);
  // Active time only: paused while the tab is hidden or the learner is idle.
  const clock = useRef(new ActiveClock(Date.now()));
  const [active, setActive] = useState(0);
  const counts = useRef({ reviews: 0, intros: 0, answers: 0 });
  const [ended, setEnded] = useState<Ended>("time");
  const [newLimitReached, setNewLimitReached] = useState(false);
  const practised = useRef(new Set<string>());
  const shownAt = useRef(0);
  const serial = useRef(0);
  // One entry per card answered, so Undo can revert what that answer recorded.
  // Each entry keeps the card's word and sentence, so Undo shows exactly that card again.
  const [undoStack, setUndoStack] = useState<{ reviewId?: string; review: boolean; intro: boolean; practised?: string; wordId: string; example?: Sentence }[]>([]);

  const start = useCallback(
    async (mins: number) => {
      // No voice, or sound turned off: no listening exercises.
      const l = live.current;
      if (!l) return;
      const voice = isSoundOn() && (await hasVoice(tag));
      const memories = l.memories.filter((m) => voice || m.skill !== "listen");
      const suspended = new Set([...l.words.values()].filter((w) => w.status === "paused" || w.status === "ignored").map((w) => w.id));
      const fresh = l.fresh();
      const p = plan({
        now: Date.now(),
        budgetMs: mins * 60_000,
        memories: memories.filter((m) => !suspended.has(m.wordId)),
        fresh,
        fsrs: scheduler,
        newToday: newWordsToday(l),
      });
      setNewLimitReached(p.newLimitReached);
      const r = new Runner(p, mins * 60_000);
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
    setCard({ task, word, example, s: read?.reps ? read.s : 0, known: wordState(read) === "known" });
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
    clearNote();
    try {
      await record(runner, card, grade, opts);
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
      if (last.review) counts.current.reviews--;
      if (!last.intro) counts.current.answers--;
      if (last.intro) counts.current.intros--;
      if (last.practised) practised.current.delete(last.practised);
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

  const record = async (runner: Runner, card: Card, grade: Grade | null, opts: { alreadyKnown?: boolean }) => {
    const ms = Math.min(clock.current.tick(Date.now()) - shownAt.current, 60_000);
    const { task, word, example } = card;
    if (task.kind === "intro") {
      counts.current.intros++;
      pop(word.lemma, 0, false);
      const reviewId = opts.alreadyKnown ? recordReview(store, { lang, word_id: word.id, skill: "read", grade: 4, kind: "known", duration_ms: Math.round(ms), sentence_id: null }) : undefined;
      runner.report(task, { alreadyKnown: opts.alreadyKnown });
      if (opts.alreadyKnown) flash("OK. No quick check now. You will see this word again in about a week.");
      setUndoStack((s) => [...s, { reviewId, review: false, intro: true, wordId: word.id, example }]);
    } else if (grade) {
      // Tests of words planted this session aren't "watering" an existing plant.
      const counted = !task.isNew;
      if (counted) counts.current.reviews++;
      counts.current.answers++;
      const fresh = !practised.current.has(word.id);
      practised.current.add(word.id);
      const reviewId = recordReview(store, { lang, word_id: word.id, skill: task.skill, grade, kind: "review", duration_ms: Math.round(ms), sentence_id: example?.id ?? null });
      if (grade >= 3) {
        // The new review shows up in the learner on the next render; let it land first.
        setTimeout(() => {
          const read = live.current ? readMemory(live.current, word.id) : undefined;
          pop(word.lemma, read?.s ?? 0, wordState(read) === "known");
        }, 0);
      }
      const retry = runner.report(task, { grade });
      if (grade === 1) flash(forgotLine(retry));
      setUndoStack((s) => [...s, { reviewId, review: counted, intro: false, practised: fresh ? word.id : undefined, wordId: word.id, example }]);
    } else {
      // Passed over without an answer ("Can't listen now"): nothing to undo, so
      // Undo steps back over this card to the last answer.
      runner.skip();
    }
  };

  return {
    learner,
    tag,
    runner,
    card,
    done,
    active,
    ended,
    newLimitReached,
    /** What this session did so far, for the summary. */
    counts: counts.current,
    practised: practised.current,
    /** Changes with every card shown, so each card mounts fresh. */
    serial: serial.current,
    canUndo: undoStack.length > 0,
    start,
    finish,
    undo,
    exit,
  };
}
