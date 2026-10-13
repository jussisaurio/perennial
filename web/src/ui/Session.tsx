import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { didLine, firstPlantsLine, summaryHeadline } from "../content/voice";
import { check, differences, passes, type Verdict } from "../core/answer";
import type { Grade } from "../core/fsrs";
import { locate } from "../content/text";
import type { Learner, Word } from "../data/learner";
import { Garden, gardenFromLearner } from "./Garden";
import { BookIcon, CloseIcon, EarIcon, PenIcon, SeedIcon, SnailIcon, SpeakerIcon, UndoIcon } from "./icons";
import { WordPlant } from "./plant";
import { Growth, grows, type GrowthMoment } from "./Growth";
import { speak, speakAll, speakSlowly, stopSpeaking } from "./speech";
import { SoundToggle, useSound } from "./Sound";
import { courseStats } from "./stats";
import { useSessionRunner, type Card, type Ended } from "./useSessionRunner";
import { useKeys } from "./useShortcut";
import { track } from "../observability";
import { DAILY_MINUTES } from "../data/practice";
import { readMemory } from "../core/memory";
import { plural } from "./format";

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
  const [help, setHelp] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // The word's plant is planted or grows before the next card (#200).
  const [growing, setGrowing] = useState<GrowthMoment | null>(null);
  const grown = useRef<(() => void) | null>(null);
  const grow = (m: GrowthMoment) => {
    if (!grows(m)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      grown.current = () => {
        grown.current = null;
        setGrowing(null);
        resolve();
      };
      setGrowing(m);
    });
  };
  // Any tap or key skips the moment. Listening starts after the answer's own
  // click or key press is over, so that one never skips it.
  useEffect(() => {
    if (!growing) return;
    const skip = () => grown.current?.();
    // The next card's keys are listening by the time this key bubbles on, so
    // the key is used up here: Space must not also show the next card's answer.
    // Escape still ends the session.
    const skipKey = (e: KeyboardEvent) => {
      skip();
      if (e.key !== "Escape") e.preventDefault();
    };
    window.addEventListener("click", skip, true);
    window.addEventListener("keydown", skipKey, true);
    return () => {
      window.removeEventListener("click", skip, true);
      window.removeEventListener("keydown", skipKey, true);
    };
  }, [growing]);

  const noteTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = (text: string) => {
    setNote(text);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 1800);
  };

  const { learner, tag, runner, card, done, active, ended, counts, practised, introduced, serial, canUndo, start, finish, undo, exit } = useSessionRunner({
    lang,
    minutes,
    onExit,
    flash,
    clearNote: () => setNote(null),
    grow,
  });

  useKeys({ z: () => void undo(), Escape: () => (help ? setHelp(false) : exit()), "?": () => setHelp((h) => !h) });

  if (!runner) return <div className="session center muted">Preparing…</div>;

  const elapsed = Math.min(1, active / runner.budgetMs);
  const overtime = runner.timeUp(active);

  return (
    <div className={growing ? "session growing" : "session"} data-card={serial}>
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
        <button className="undo" onClick={() => void undo()} disabled={!canUndo} title="Undo last answer (Z)">
          <UndoIcon size={18} /> Undo
        </button>
      </header>
      {done ? (
        <Summary learner={learner} counts={counts} practised={practised} introduced={introduced} ended={ended} onMore={() => void start(DAILY_MINUTES)} onExit={onExit} />
      ) : card ? (
        <CardView key={serial} card={card} tag={tag} lang={lang} onDone={finish} />
      ) : null}
      {note && (
        <div className="session-note" role="status">
          {note}
        </div>
      )}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
      {card && !done && (
        <div className="card-plant" key={`plant-${serial}`} aria-hidden="true">
          <WordPlant word={card.word.lemma} s={card.s} stage={card.stage} size={76} />
        </div>
      )}
      {/* ?.: a tap may already have ended the moment. */}
      {growing && <Growth m={growing} onDone={() => grown.current?.()} />}
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
        <button onClick={() => void speakSlowly(text, tag)} aria-label="Play slowly" title="Play slowly">
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

function Meaning({ word }: { word: Word }) {
  return (
    <div className="meaning">
      <div>
        <strong>{word.lemma}</strong>
        {word.pos && <span className="pos">{word.pos}</span>}
        {word.gloss}
      </div>
      {word.notes && <div className="muted small">{word.notes}</div>}
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="actions">{children}</div>;
}

/**
 * A card's answer, hidden until shown. Answers given within GUARD_MS of showing
 * are ignored: "Show" sits where the answer buttons appear, so a double-click
 * or double-tap would otherwise answer a card nobody has read.
 */
function useReveal() {
  const [revealed, setRevealed] = useState(false);
  const reveal = () => setRevealed(true);
  // Exposed as data-armed so tests can wait for the guard instead of sleeping.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setArmed(true), GUARD_MS);
    return () => clearTimeout(t);
  }, [revealed]);
  const guarded = (answer: () => void) => () => {
    if (armed) answer();
  };
  return { revealed, reveal, guarded, armed };
}

// The meaning stays hidden until the learner has tried to recall it: once an
// answer is in view, "I knew it" is too easy to believe (#196).
function Intro({ card, tag, onDone }: { card: Card; tag: string; onDone: (g: Grade | null, o?: { alreadyKnown?: boolean }) => void }) {
  const { word, example } = card;
  const { revealed, reveal, guarded, armed } = useReveal();
  const play = useCallback(() => void speakAll(example ? [word.lemma, example.text] : [word.lemma], tag), [word.lemma, example, tag]);
  // The sentence follows the word; leaving the card cuts both off, so it never plays over the next one.
  useEffect(() => {
    play();
    return stopSpeaking;
  }, [play]);
  const isNew = guarded(() => onDone(null));
  const knewIt = guarded(() => onDone(null, { alreadyKnown: true }));
  // Answers are always 1 / ← (the left button) and 2 / → (the right one).
  useKeys(revealed ? { "1": isNew, ArrowLeft: isNew, "2": knewIt, ArrowRight: knewIt, r: play } : { " ": reveal, Enter: reveal, r: play });
  return (
    <main className="card" data-armed={armed || undefined}>
      <Kicker kind="intro" />
      <div className="word">
        {word.lemma} <Speaker text={word.lemma} tag={tag} />
      </div>
      {revealed && (
        <div className="gloss">
          {word.pos && <span className="pos">{word.pos}</span>}
          {word.gloss}
        </div>
      )}
      {revealed && word.notes && <p className="hint">{word.notes}</p>}
      {example && (
        <div className="example">
          <p className="sentence" lang={tag}>
            <Highlight text={example.text} part={example.cloze} /> <Speaker text={example.text} tag={tag} slow />
          </p>
          {revealed && <p className="translation">{example.translation}</p>}
        </div>
      )}
      {revealed ? (
        <div className="question">
          <p className="prompt">Is this word new to you?</p>
          <div className="answers">
            <button className="answer-btn primary" onClick={isNew}>
              <strong>
                New to me <kbd>1</kbd>
              </strong>
              <span>Learn it now. A quick check comes in a moment.</span>
            </button>
            <button className="answer-btn" onClick={knewIt}>
              <strong>
                I knew it <kbd>2</kbd>
              </strong>
              <span>Skip the quick check. Back in about a week.</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="prompt">Do you know what it means? Think first, then look.</p>
          <Actions>
            <button className="primary wide" onClick={reveal}>
              Show meaning <kbd>Space</kbd>
            </button>
          </Actions>
        </>
      )}
    </main>
  );
}

function Recall({ card, tag, listen, onDone, kicker }: { card: Card; tag: string; listen: boolean; onDone: (g: Grade | null) => void; kicker: keyof typeof KICKERS }) {
  const { word, example } = card;
  const { revealed, reveal, guarded, armed } = useReveal();
  const grade = (g: Grade) => guarded(() => onDone(g))();
  const audioText = example?.text ?? word.lemma;
  const play = () => void speak(audioText, tag);
  useEffect(() => {
    if (listen) void speak(audioText, tag);
  }, [listen, audioText, tag]);
  useEffect(() => {
    if (revealed && !listen) void speak(audioText, tag);
  }, [revealed, listen, audioText, tag]);
  useKeys(
    revealed
      ? { "1": () => grade(1), ArrowLeft: () => grade(1), "2": () => grade(3), ArrowRight: () => grade(3), r: play }
      : { " ": reveal, Enter: reveal, r: play },
  );
  // Grades are about the word; on a listening card that means "did I catch it".
  const [no, yes] = listen ? ["Did not understand", "Understood"] : ["I forgot", "I remembered"];
  return (
    <main className="card" data-lemma={word.lemma} data-armed={armed || undefined}>
      <Kicker kind={kicker} />
      <p className="prompt">
        {listen ? (
          "Listen. What does the sentence mean?"
        ) : (
          <>
            What does <b lang={tag}>{example?.cloze || word.lemma}</b> mean?
          </>
        )}
      </p>
      {kicker === "check" && !revealed && <p className="hint">Think of the meaning first. Then show the answer and say honestly if you remembered it. Forgetting is normal.</p>}
      {listen && !revealed ? (
        <div className="listen">
          <button className="play" onClick={play} aria-label="Play again">
            <SpeakerIcon size={34} />
          </button>
          <button className="ghost" onClick={() => void speakSlowly(audioText, tag)}>
            <SnailIcon size={18} /> slower
          </button>
        </div>
      ) : example ? (
        <p className="sentence big" lang={tag}>
          <Highlight text={example.text} part={example.cloze} />
          {revealed && <Speaker text={example.text} tag={tag} slow />}
        </p>
      ) : (
        <div className="word">{word.lemma}</div>
      )}
      {revealed ? (
        <>
          <div className="reveal">
            {example && <p className="translation">{example.translation}</p>}
            <Meaning word={word} />
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
  const { word, example } = card;
  const target = example?.cloze ?? word.lemma;
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
    void speak(example?.text ?? word.lemma, tag);
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
          <p className="hint">Meaning: {word.gloss}</p>
        </>
      ) : (
        <div className="word">{word.gloss}</div>
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
          <Meaning word={word} />
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
  ["Space / Enter", "Show the answer or meaning, Check, Next"],
  ["1 or ←", "The left answer: New to me, I forgot"],
  ["2 or →", "The right answer: I knew it, I remembered"],
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
  introduced,
  ended,
  onMore,
  onExit,
}: {
  learner: Learner | null;
  counts: { intros: number; answers: number };
  practised: Set<string>;
  introduced: Set<string>;
  ended: Ended;
  onMore: () => void;
  onExit: () => void;
}) {
  const stats = useMemo(() => (learner ? courseStats(learner) : null), [learner]);
  // Once per summary: an Undo from here changes the counts, but it also leaves the summary.
  useEffect(() => track("session_finished", { ended, answers: counts.answers, newWords: counts.intros }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const garden = useMemo(() => (learner ? gardenFromLearner(learner) : null), [learner]);
  useKeys(useMemo(() => ({ Enter: onExit }), [onExit]));
  // A new word is a planted seed once it has an answer: its quick check, or "I knew it".
  // Watered: plants that were already in the garden before this session.
  const seeds = learner ? [...introduced].filter((id) => readMemory(learner, id)?.reps).length : 0;
  const watered = [...practised].filter((id) => !introduced.has(id)).length;
  const met = introduced.size - seeds;
  const did = seeds + watered > 0;
  const highlight = useMemo(() => new Set([...practised, ...introduced]), [practised, introduced]);
  const [headline] = useState(() => summaryHeadline(learner?.course.lang ?? ""));
  const title = ended === "user" ? "Session paused" : "Session complete";
  const why = ended === "user" ? "You can continue later. Your answers are saved." : ended === "empty" ? "Every plant has water." : null;
  return (
    <main className="card summary">
      <div className="kicker read">
        <SeedIcon size={15} /> {title.toLowerCase()}
      </div>
      <h1>{did ? didLine(seeds, watered) : met > 0 ? `You saw ${plural(met, "new word")}.` : "Nothing was planted or watered."}</h1>
      {did && (
        <p className="muted headline-small">
          {headline.line}
          {headline.small && ` ${headline.small}`}
        </p>
      )}
      {why && <p className="muted">{why}</p>}
      <Garden data={garden} highlight={highlight} compact />
      {garden && seeds > 0 && garden.total === seeds && <p className="muted small first-plants">{firstPlantsLine(garden.total)}</p>}
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
        <button className="secondary" onClick={onMore}>
          Practice {DAILY_MINUTES} more minutes
        </button>
        <button className="primary" onClick={onExit}>
          Done <kbd>Enter</kbd>
        </button>
      </div>
    </main>
  );
}
