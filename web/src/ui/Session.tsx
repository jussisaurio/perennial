import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { firstPlantsLine, forgotLine, summaryHeadline } from "../content/voice";
import { check, differences, passes, type Verdict } from "../core/answer";
import type { Grade } from "../core/fsrs";
import { ActiveClock } from "../core/clock";
import { MAX_NEW_PER_DAY, plan, Session as Runner, type Task } from "../core/session";
import { fsrs as scheduler } from "../core/scheduler";
import { language } from "../content/languages";
import { locate } from "../content/text";
import { hash32 } from "../lib/seed";
import { memKey, recordReview, undoReview, useLearner, useStore, type Learner, type Sentence, type Word } from "../data/learner";
import { Garden, gardenFromLearner } from "./Garden";
import { BookIcon, CloseIcon, EarIcon, PenIcon, SeedIcon, SnailIcon, SpeakerIcon, UndoIcon } from "./icons";
import { WordPlant } from "./plant";
import { hasVoice, isSoundOn, speak, speakAll, stopSpeaking } from "./speech";
import { SoundToggle, useSound } from "./Sound";
import { courseStats, wordState } from "./stats";
import { useKeys } from "./useShortcut";
import { track } from "../observability";

type Lexeme = Word;
type Example = Sentence;

interface Card {
  task: Task;
  lexeme: Lexeme;
  example?: Example;
  /** Reading-memory stability and whether the word counts as known, for its plant. */
  s: number;
  known: boolean;
}

/** Pick the sentence the learner has seen least, so no two reviews look the same. */
function chooseExample(l: Learner, wordId: string): Example | undefined {
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

/** The correct answer with the letters to look at marked. */
function Marked({ text, at }: { text: string; at: Set<number> }) {
  return (
    <strong>
      {[...text.normalize("NFC")].map((ch, i) => (at.has(i) ? <mark key={i} className="letter">{ch}</mark> : <span key={i}>{ch}</span>))}
    </strong>
  );
}

function Highlight({ text, part, blank }: { text: string; part: string; blank?: boolean }) {
  const i = locate(text, part);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      {blank ? <span className="blank">{" ".repeat(Math.max(4, [...part].length))}</span> : <mark>{part}</mark>}
      {text.slice(i + part.length)}
    </>
  );
}

export function SessionScreen({ lang, onExit, minutes }: { lang: string; onExit: () => void; minutes: number }) {
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
  const [ended, setEnded] = useState<"time" | "empty" | "user">("time");
  const [newLimitReached, setNewLimitReached] = useState(false);
  const [help, setHelp] = useState(false);
  const practised = useRef(new Set<string>());
  const [pops, setPops] = useState<{ id: number; word: string; s: number; known: boolean }[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const shownAt = useRef(0);
  const serial = useRef(0);
  // One entry per card answered, so Undo can revert what that answer recorded.
  // Each entry keeps the card's word and sentence, so Undo shows exactly that card again.
  const [undoStack, setUndoStack] = useState<{ reviewId?: string; review: boolean; intro: boolean; practised?: string; lexemeId: string; example?: Example }[]>([]);

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
        memories: memories.filter((m) => !suspended.has(m.lexemeId)),
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
  const advance = async (r: Runner, again?: { lexemeId: string; example?: Example }) => {
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
    const lexeme = l.words.get(task.lexemeId);
    if (!lexeme) {
      // The word is gone (deleted on another device): pass over it, and keep it out of Undo.
      r.skip();
      return advance(r);
    }
    const example = again?.lexemeId === lexeme.id ? again.example : chooseExample(l, lexeme.id);
    const read = l.memory.get(memKey(lexeme.id, "read"));
    shownAt.current = clock.current.elapsed;
    serial.current++;
    setDone(false);
    // A focused button from the last card would also receive Space/Enter.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setCard({ task, lexeme, example, s: read?.reps ? read.s : 0, known: wordState(read) === "known" });
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
    setNote(null); // a note is about the previous card; don't let it linger
    try {
      await record(runner, card, grade, opts);
      await advance(runner);
    } finally {
      busy.current = false;
    }
  };

  // The word's own plant pops up and grows when you plant or remember it.
  const pop = (word: string, s: number, known: boolean) => {
    const id = Date.now() + Math.random();
    setPops((p) => [...p, { id, word, s, known }]);
    setTimeout(() => setPops((p) => p.filter((x) => x.id !== id)), 1300);
  };

  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = (text: string) => {
    setNote(text);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 2200);
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
    const { task, lexeme, example } = card;
    if (task.kind === "intro") {
      counts.current.intros++;
      pop(lexeme.lemma, 0, false);
      const reviewId = opts.alreadyKnown ? recordReview(store, { lang, word_id: lexeme.id, skill: "read", grade: 4, kind: "known", duration_ms: Math.round(ms), sentence_id: null }) : undefined;
      runner.report(task, { alreadyKnown: opts.alreadyKnown });
      if (opts.alreadyKnown) flash("OK. No quick check now. You will see this word again in about a week.");
      setUndoStack((s) => [...s, { reviewId, review: false, intro: true, lexemeId: lexeme.id, example }]);
    } else if (grade) {
      // Tests of words planted this session aren't "watering" an existing plant.
      const counted = !task.isNew;
      if (counted) counts.current.reviews++;
      counts.current.answers++;
      const fresh = !practised.current.has(lexeme.id);
      practised.current.add(lexeme.id);
      const reviewId = recordReview(store, { lang, word_id: lexeme.id, skill: task.skill, grade, kind: "review", duration_ms: Math.round(ms), sentence_id: example?.id ?? null });
      if (grade >= 3) {
        // The new review shows up in the learner on the next render; let it land first.
        setTimeout(() => {
          const read = live.current?.memory.get(memKey(lexeme.id, "read"));
          pop(lexeme.lemma, read?.s ?? 0, wordState(read) === "known");
        }, 0);
      }
      const retry = runner.report(task, { grade });
      if (grade === 1) flash(forgotLine(retry));
      setUndoStack((s) => [...s, { reviewId, review: counted, intro: false, practised: fresh ? lexeme.id : undefined, lexemeId: lexeme.id, example }]);
    } else {
      // Passed over without an answer ("Can't listen now"): nothing to undo, so
      // Undo steps back over this card to the last answer.
      runner.skip();
    }
  };

  useKeys({ z: () => void undo(), Escape: () => (help ? setHelp(false) : exit()), "?": () => setHelp((h) => !h) });

  if (!runner) return <div className="session center muted">Preparing…</div>;

  const elapsed = Math.min(1, active / runner.budgetMs);
  const overtime = runner.timeUp(active);

  return (
    <div className="session" data-card={serial.current}>
      <header className="session-bar">
        <button className="icon" onClick={exit} aria-label="End session" title="End session">
          <CloseIcon />
        </button>
        <div className="vine" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(elapsed * 100)} aria-label="Session time">
          <div className="grow" style={{ width: `${elapsed * 100}%` }} />
          <div className="tip" style={{ left: `${elapsed * 100}%` }}>
            <SeedIcon size={16} />
          </div>
        </div>
        <span className="time-left">{done ? "" : overtime ? "finishing" : `${Math.max(1, Math.ceil((runner.budgetMs - active) / 60_000))} min left`}</span>
        <SoundToggle />
        <button className="undo" onClick={() => void undo()} disabled={!undoStack.length} title="Undo last answer (Z)">
          <UndoIcon size={18} /> Undo
        </button>
      </header>
      {done ? (
        <Summary learner={learner} counts={counts.current} practised={practised.current} ended={ended} newLimitReached={newLimitReached} onMore={() => void start(5)} onExit={onExit} />
      ) : card ? (
        <CardView key={serial.current} card={card} tag={tag} lang={lang} onDone={finish} />
      ) : null}
      {note && (
        <div className="session-note" role="status">
          {note}
        </div>
      )}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
      {card && !done && (
        <div className="card-plant" key={`plant-${serial.current}`} aria-hidden="true">
          <WordPlant word={card.lexeme.lemma} s={card.s} known={card.known} size={76} />
        </div>
      )}
      {pops.map((p) => (
        <div key={p.id} className="plant-pop" aria-hidden="true">
          <WordPlant word={p.word} s={p.s} known={p.known} size={84} />
        </div>
      ))}
    </div>
  );
}

function CardView({ card, tag, lang, onDone }: { card: Card; tag: string; lang: string; onDone: (g: Grade | null, o?: { alreadyKnown?: boolean }) => void }) {
  const { task } = card;
  if (task.kind === "intro") return <Intro card={card} tag={tag} onDone={onDone} />;
  if (task.skill === "write") return <Write card={card} tag={tag} lang={lang} onDone={onDone} kicker={task.retry ? "retry" : task.isNew ? "newWrite" : "write"} />;
  const listen = task.skill === "listen";
  // A first "read" review is the check on a word introduced moments ago.
  const kicker = task.retry ? "retry" : task.isNew ? (listen ? "newListen" : "check") : listen ? "listen" : "read";
  return <Recall card={card} tag={tag} listen={listen} onDone={onDone} kicker={kicker} />;
}

function Speaker({ text, tag, slow }: { text: string; tag: string; slow?: boolean }) {
  const [sound] = useSound();
  if (!sound) return null;
  return (
    <span className="speaker">
      <button onClick={() => void speak(text, tag)} aria-label="Play audio" title="Play">
        <SpeakerIcon size={18} />
      </button>
      {slow && (
        <button onClick={() => void speak(text, tag, 0.65)} aria-label="Play slowly" title="Play slowly">
          <SnailIcon size={18} />
        </button>
      )}
    </span>
  );
}

/** Ignore answer input this soon after revealing, to absorb accidental double-clicks. */
const GUARD_MS = 400;

const KICKERS = {
  intro: { icon: <SeedIcon size={15} />, text: "new word" },
  read: { icon: <BookIcon size={15} />, text: "reading" },
  listen: { icon: <EarIcon size={15} />, text: "listening" },
  write: { icon: <PenIcon size={15} />, text: "writing" },
  check: { icon: <SeedIcon size={15} />, text: "quick check · new word" },
  retry: { icon: <UndoIcon size={15} />, text: "try again" },
  newListen: { icon: <EarIcon size={15} />, text: "first listening practice" },
  newWrite: { icon: <PenIcon size={15} />, text: "first writing practice" },
};

function Kicker({ kind }: { kind: keyof typeof KICKERS }) {
  return (
    <div className={`kicker ${kind}`}>
      {KICKERS[kind].icon}
      {KICKERS[kind].text}
    </div>
  );
}

function Meaning({ lexeme }: { lexeme: Lexeme }) {
  return (
    <div className="meaning">
      <div>
        <strong>{lexeme.lemma}</strong>
        {lexeme.pos && <span className="pos">{lexeme.pos}</span>}
        {lexeme.gloss}
      </div>
      {lexeme.notes && <div className="muted small">{lexeme.notes}</div>}
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="actions">{children}</div>;
}

function Intro({ card, tag, onDone }: { card: Card; tag: string; onDone: (g: Grade | null, o?: { alreadyKnown?: boolean }) => void }) {
  const { lexeme, example } = card;
  const play = () => void speakAll(example ? [lexeme.lemma, example.text] : [lexeme.lemma], tag);
  // The sentence follows the word; leaving the card cuts both off, so it never plays over the next one.
  useEffect(() => {
    play();
    return stopSpeaking;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lexeme.lemma, example, tag]);
  const isNew = () => onDone(null);
  const knewIt = () => onDone(null, { alreadyKnown: true });
  useKeys({ " ": isNew, Enter: isNew, n: isNew, k: knewIt, r: play });
  return (
    <main className="card">
      <Kicker kind="intro" />
      <div className="word">
        {lexeme.lemma} <Speaker text={lexeme.lemma} tag={tag} />
      </div>
      <div className="gloss">
        {lexeme.pos && <span className="pos">{lexeme.pos}</span>}
        {lexeme.gloss}
      </div>
      {lexeme.notes && <p className="hint">{lexeme.notes}</p>}
      {example && (
        <div className="example">
          <p className="sentence" lang={tag}>
            <Highlight text={example.text} part={example.cloze} /> <Speaker text={example.text} tag={tag} slow />
          </p>
          <p className="translation">{example.translation}</p>
        </div>
      )}
      <div className="question">
        <p className="prompt">Is this word new to you?</p>
        <div className="answers">
          <button className="answer-btn" onClick={knewIt}>
            <strong>
              I knew it <kbd>K</kbd>
            </strong>
            <span>Skip the quick check. Back in about a week.</span>
          </button>
          <button className="answer-btn primary" onClick={isNew}>
            <strong>
              New to me <kbd>Space</kbd>
            </strong>
            <span>Learn it now. A quick check comes in a moment.</span>
          </button>
        </div>
      </div>
    </main>
  );
}

function Recall({ card, tag, listen, onDone, kicker }: { card: Card; tag: string; listen: boolean; onDone: (g: Grade | null) => void; kicker: keyof typeof KICKERS }) {
  const { lexeme, example } = card;
  const [revealed, setRevealed] = useState(false);
  const revealedAt = useRef(0);
  const reveal = () => {
    revealedAt.current = Date.now();
    setRevealed(true);
  };
  // "Show answer" sits where the grade buttons appear; ignore a double-click
  // or double-tap so nobody grades an answer they haven't read.
  const grade = (g: Grade) => {
    if (Date.now() - revealedAt.current >= GUARD_MS) onDone(g);
  };
  const audioText = example?.text ?? lexeme.lemma;
  const play = () => void speak(audioText, tag);
  useEffect(() => {
    if (listen) void speak(audioText, tag);
  }, [listen, audioText, tag]);
  useEffect(() => {
    if (revealed && !listen) void speak(audioText, tag);
  }, [revealed, listen, audioText, tag]);
  useKeys(
    revealed
      ? { "1": () => grade(1), ArrowLeft: () => grade(1), "2": () => grade(3), "3": () => grade(3), "4": () => grade(3), ArrowRight: () => grade(3), " ": () => grade(3), Enter: () => grade(3), r: play }
      : { " ": reveal, Enter: reveal, r: play },
  );
  // Grades are about the word; on a listening card that means "did I catch it".
  const [no, yes] = listen ? ["Did not understand", "Understood"] : ["I forgot", "I remembered"];
  return (
    <main className="card" data-lemma={lexeme.lemma}>
      <Kicker kind={kicker} />
      <p className="prompt">
        {listen ? (
          "Listen. What does the sentence mean?"
        ) : (
          <>
            What does <b lang={tag}>{example?.cloze || lexeme.lemma}</b> mean?
          </>
        )}
      </p>
      {kicker === "check" && !revealed && <p className="hint">Think of the meaning first. Then show the answer and say honestly if you remembered it. Forgetting is normal.</p>}
      {listen && !revealed ? (
        <div className="listen">
          <button className="play" onClick={play} aria-label="Play again">
            <SpeakerIcon size={34} />
          </button>
          <button className="ghost" onClick={() => void speak(audioText, tag, 0.65)}>
            <SnailIcon size={18} /> slower
          </button>
        </div>
      ) : example ? (
        <p className="sentence big" lang={tag}>
          <Highlight text={example.text} part={example.cloze} />
          {revealed && <Speaker text={example.text} tag={tag} slow />}
        </p>
      ) : (
        <div className="word">{lexeme.lemma}</div>
      )}
      {revealed ? (
        <>
          <div className="reveal">
            {example && <p className="translation">{example.translation}</p>}
            <Meaning lexeme={lexeme} />
          </div>
          <Actions>
            <button className="fail" onClick={() => grade(1)}>
              {no} <kbd>1</kbd>
            </button>
            <button className="pass" onClick={() => grade(3)}>
              {yes} <kbd>2</kbd>
            </button>
          </Actions>
        </>
      ) : (
        <Actions>
          {listen && (
            // No sound possible right now: move on without a grade.
            <button className="ghost" onClick={() => onDone(null)}>
              Can't listen now
            </button>
          )}
          <button className="primary wide" onClick={reveal}>
            Show answer <kbd>Space</kbd>
          </button>
        </Actions>
      )}
    </main>
  );
}

function Write({ card, tag, lang, onDone, kicker }: { card: Card; tag: string; lang: string; onDone: (g: Grade | null) => void; kicker: keyof typeof KICKERS }) {
  const { lexeme, example } = card;
  const target = example?.cloze ?? lexeme.lemma;
  const [value, setValue] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const grade: Grade = verdict && passes(verdict) ? 3 : 1;
  const checkedAt = useRef(0);

  const submit = () => {
    if (verdict) {
      if (Date.now() - checkedAt.current >= GUARD_MS) onDone(grade);
      return;
    }
    const v = check(value, target, lang);
    checkedAt.current = Date.now();
    setVerdict(v);
    void speak(example?.text ?? lexeme.lemma, tag);
  };

  return (
    <main className="card">
      <Kicker kind={kicker} />
      <p className="prompt">Type the missing word.</p>
      {example ? (
        <>
          <p className="translation big">{example.translation}</p>
          <p className="sentence" lang={tag}>
            <Highlight text={example.text} part={example.cloze} blank={!verdict} />
          </p>
          <p className="hint">Meaning: {lexeme.gloss}</p>
        </>
      ) : (
        <div className="word">{lexeme.gloss}</div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          ref={input}
          className={`answer ${verdict ? (verdict === "exact" ? "ok" : passes(verdict) ? "warn" : "bad") : ""}`}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          readOnly={!!verdict}
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          lang={tag}
          placeholder="missing word"
        />
      </form>
      {verdict && (
        <div className="feedback">
          {verdict === "exact" && <span className="ok">Correct.</span>}
          {verdict === "accent" && (
            <span className="warn">
              Counted as correct, but look at the marked letters: <Marked text={target} at={differences(value, target)} />
            </span>
          )}
          {verdict === "typo" && (
            <span className="warn">
              Small typing error, counted as correct: <Marked text={target} at={differences(value, target)} />
            </span>
          )}
          {verdict === "wrong" && (
            <span className="bad">
              Correct answer: <strong>{target}</strong>
            </span>
          )}
          <Meaning lexeme={lexeme} />
        </div>
      )}
      <Actions>
        {verdict === "wrong" && (
          <button className="secondary" onClick={() => onDone(3)}>
            My answer was correct
          </button>
        )}
        {(verdict === "accent" || verdict === "typo") && (
          // The checker was generous; the learner knows better.
          <button className="secondary" onClick={() => onDone(1)}>
            Count it as wrong
          </button>
        )}
        <button className={verdict && passes(verdict) ? "pass" : "primary"} onClick={submit}>
          {verdict ? "Next" : "Check"} <kbd>Enter</kbd>
        </button>
      </Actions>
    </main>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Space / Enter", "Show answer, then I remembered"],
  ["1 or ←", "I forgot"],
  ["2, 3 or →", "I remembered"],
  ["K", "New word: I knew it"],
  ["R", "Play the audio again"],
  ["Z", "Undo the last answer"],
  ["Esc", "End the session"],
  ["?", "Show or hide this list"],
];

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="shortcut-help" role="dialog" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="panel" onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard shortcuts</h2>
        <dl>
          {SHORTCUTS.map(([k, v]) => (
            <div key={k}>
              <dt>
                <kbd>{k}</kbd>
              </dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

function Summary({
  learner,
  counts,
  practised,
  ended,
  newLimitReached,
  onMore,
  onExit,
}: {
  learner: Learner | null;
  counts: { reviews: number; intros: number; answers: number };
  practised: Set<string>;
  ended: "time" | "empty" | "user";
  newLimitReached: boolean;
  onMore: () => void;
  onExit: () => void;
}) {
  const stats = useMemo(() => (learner ? courseStats(learner) : null), [learner]);
  useEffect(() => track("session_finished", { ended, answers: counts.answers, newWords: counts.intros }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const garden = useMemo(() => (learner ? gardenFromLearner(learner) : null), [learner]);
  useKeys(useMemo(() => ({ Enter: onExit }), [onExit]));
  const did = counts.answers + counts.intros > 0;
  const [headline] = useState(() => summaryHeadline(learner?.course.lang ?? ""));
  const title = ended === "user" ? "Session paused" : "Session complete";
  const why =
    ended === "user"
      ? "You can continue later. Your answers are saved."
      : ended === "empty"
        ? newLimitReached
          ? `That is all for today: ${MAX_NEW_PER_DAY} new words is the daily limit, and no other words need practice now. More new words tomorrow.`
          : "Every plant has water. Come back tomorrow."
        : null;
  return (
    <main className="card summary">
      <div className="kicker read">
        <SeedIcon size={15} /> {title.toLowerCase()}
      </div>
      <h1>{did ? headline.line : "Nothing to practice now."}</h1>
      {did && headline.small && <p className="muted small headline-small">{headline.small}</p>}
      {why && <p className="muted">{why}</p>}
      <div className="tally">
        <div>
          {counts.intros}
          <span>{counts.intros === 1 ? "new word" : "new words"}</span>
        </div>
        <div>
          {counts.answers}
          <span>{counts.answers === 1 ? "answer" : "answers"}</span>
        </div>
      </div>
      <Garden data={garden} highlight={practised} compact />
      {garden && counts.intros > 0 && garden.total === counts.intros && <p className="muted small first-plants">{firstPlantsLine(garden.total)}</p>}
      {stats && (
        <p>
          {stats.known > 0 ? (
            <>
              You know <strong>{stats.known}</strong> {stats.known === 1 ? "word" : "words"}.{stats.learning > 0 && <> You are learning {stats.learning} more.</>}
            </>
          ) : (
            <>You started {stats.learning} {stats.learning === 1 ? "word" : "words"}. A word counts as known when you still remember it a week later.</>
          )}
        </p>
      )}
      <div className="actions static">
        {ended === "time" && (
          <button className="secondary" onClick={onMore}>
            Practice 5 more minutes
          </button>
        )}
        <button className="primary" onClick={onExit}>
          Done <kbd>Enter</kbd>
        </button>
      </div>
    </main>
  );
}

/** New words introduced today: their first reading review happened today. */
function newWordsToday(l: Learner): number {
  const startOfDay = new Date().setHours(0, 0, 0, 0);
  const first = new Map<string, number>();
  for (const r of l.reviews) {
    if (r.skill !== "read") continue;
    const id = l.resolve(r.word_id);
    const t = Date.parse(r.reviewed_at);
    const prev = first.get(id);
    if (prev === undefined || t < prev) first.set(id, t);
  }
  return [...first.values()].filter((t) => t >= startOfDay).length;
}
