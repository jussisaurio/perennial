import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { didLine, firstPlantsLine, summaryHeadline } from "../content/voice";
import { check, differences, passes, type Verdict } from "../core/answer";
import type { Grade } from "../core/fsrs";
import { askedForm, headword, otherForm } from "../content/forms";
import { locate } from "../content/text";
import type { Learner, Word } from "../data/learner";
import { Garden, gardenFromLearner } from "./Garden";
import { BookIcon, CloseIcon, EarIcon, PenIcon, SeedIcon, SnailIcon, SpeakerIcon, UndoIcon } from "./icons";
import { rareOf, WordPlant, type Rare } from "./plant";
import { chimeDelay, Growth, growthOn, grows, type GrowthMoment, type PlantLook } from "./Growth";
import { chime } from "./chime";
import { speak, speakAll, speakSlowly, stopSpeaking } from "./speech";
import { SoundToggle, useSound } from "./Sound";
import { courseStats } from "./stats";
import { useSessionRunner, type Card, type Ended } from "./useSessionRunner";
import { RefusedLine, useRefused } from "./Refused";
import type { Refused } from "../data/store";
import { useKeys, useShortcut } from "./useShortcut";
import { track } from "../observability";
import { DAILY_MINUTES } from "../data/practice";
import { KNOWN_RULE, plantStage, readMemory } from "../core/memory";
import { plural } from "./format";
import { focusPlant } from "./gardenFocus";
import { broughtVisitor, gardenBrought } from "./visitors";
import { sessionVisit, type SessionVisit } from "../garden/sessionVisitor";
import { GARDEN_VISITOR_ART } from "../garden/visitorArt";
import { PixelRects } from "./pixel";
import { startOfDay, today } from "../core/day";
import { visitor, VISITORS, type VisitorView, visitorViews } from "../garden/visitors";

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

/** How many answers the learner gives before the quick-check hint stops showing. */
const HINT_ANSWERS = 3;

export function SessionScreen({ lang, onExit, onWalk, minutes }: { lang: string; onExit: () => void; onWalk: () => void; minutes: number }) {
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
      chime(m.word, chimeDelay(m) / 1000);
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
  const flash = (text: string, ms = 1800) => {
    setNote(text);
    clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), ms);
  };

  const { learner, tag, runner, card, done, active, ended, counts, refusedBefore, practised, introduced, before, arrived, serial, canUndo, start, finish, undo, exit, resume, firstSummary } = useSessionRunner({
    lang,
    minutes,
    onExit,
    flash,
    clearNote: () => setNote(null),
    grow,
  });

  // Sometimes a visitor the learner has brought comes to watch this chunk (#210). Worked
  // out when a chunk starts (a new runner), from the learner as it is then.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per chunk, not on every answer
  const watching = useMemo(() => (runner && learner ? watcherFor(learner, serial) : null), [runner]);

  useKeys({ z: () => void undo(), Escape: () => (help ? setHelp(false) : exit()), "?": () => setHelp((h) => !h) });

  if (!runner) return <div className="session center muted">Preparing…</div>;

  // The quick-check hint is for a learner's first few answers; after that it is noise (#270).
  const hint = !!learner && learner.reviews.filter((r) => r.kind === "review").length < HINT_ANSWERS;

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
      {/* During the session and on its summary: in place, never over the answer buttons. */}
      <RefusedLine since={refusedBefore} />
      {done ? (
        <Summary learner={learner} counts={counts} refusedBefore={refusedBefore} practised={practised} introduced={introduced} before={before} arrived={arrived} ended={ended} onMore={() => void start(DAILY_MINUTES)} onContinue={resume} onExit={onExit} onWalk={onWalk} firstSummary={firstSummary} />
      ) : card ? (
        <CardView key={serial} card={card} tag={tag} lang={lang} hint={hint} onDone={finish} />
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
      {watching && card && !done && serial - watching.start >= watching.visit.from - 1 && serial - watching.start < watching.visit.to - 1 && <Watcher view={watching.view} />}
    </div>
  );
}

function CardView({ card, tag, lang, hint, onDone }: { card: Card; tag: string; lang: string; hint: boolean; onDone: (g: Grade | null, o?: { alreadyKnown?: boolean }) => void }) {
  const { task } = card;
  if (task.kind === "intro") return <Intro card={card} tag={tag} lang={lang} onDone={onDone} />;
  if (task.skill === "write") return <Write card={card} tag={tag} lang={lang} onDone={onDone} kicker={task.retry ? "retry" : task.isNew ? "newWrite" : "write"} />;
  const listen = task.skill === "listen";
  // A first "read" review is the check on a word introduced moments ago.
  const kicker = task.retry ? "retry" : task.isNew ? (listen ? "newListen" : "check") : listen ? "listen" : "read";
  return <Recall card={card} tag={tag} lang={lang} listen={listen} onDone={onDone} kicker={kicker} hint={hint && kicker === "check"} />;
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

/** The dictionary word, and how the asked form belongs to it ("soy is a form of ser", #259). */
function Meaning({ word, lang, asked }: { word: Word; lang: string; asked?: string }) {
  const form = asked && otherForm(word, asked);
  const head = headword(word, lang);
  return (
    <div className="meaning">
      <div>
        <strong>{head}</strong>
        {word.pos && <span className="pos">{word.pos}</span>}
        {word.gloss}
      </div>
      {form && (
        <div className="small form-of">
          <b>{form}</b> is a form of <b>{head}</b>.
        </div>
      )}
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
function Intro({ card, tag, lang, onDone }: { card: Card; tag: string; lang: string; onDone: (g: Grade | null, o?: { alreadyKnown?: boolean }) => void }) {
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
        {headword(word, lang)} <Speaker text={word.lemma} tag={tag} />
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

function Recall({ card, tag, lang, listen, onDone, kicker, hint }: { card: Card; tag: string; lang: string; listen: boolean; onDone: (g: Grade | null) => void; kicker: keyof typeof KICKERS; hint: boolean }) {
  const { word, example } = card;
  const asked = askedForm(word, example);
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
            What does <b lang={tag}>{asked}</b> mean?
          </>
        )}
      </p>
      {/* It stays when the answer shows, so the card does not jump. */}
      {hint && <p className="hint">Think of the meaning first. Then show the answer and say honestly if you remembered it. Forgetting is normal.</p>}
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
            <Meaning word={word} lang={lang} asked={asked} />
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
  // Checking shows the answer: Enter pressed twice must not also move on past it.
  const { reveal, guarded, armed } = useReveal();

  const submit = () => {
    if (verdict) {
      guarded(() => onDone(grade))();
      return;
    }
    setVerdict(check(value, target, lang));
    reveal();
    void speak(example?.text ?? word.lemma, tag);
  };

  return (
    <main className="card" data-armed={armed || undefined}>
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
          <Meaning word={word} lang={lang} asked={askedForm(word, example)} />
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

const RARE_NEWS: Record<Rare, string> = { golden: "with a golden flower", twin: "with two flowers", bee: "with a bee on it", striped: "with striped petals" };

/**
 * One line of real news from this chunk for the summary (#232), or null on a
 * plain day: never a routine prompt. A visitor that came first, then a rare
 * flower that opened, then any flower that opened for the first time.
 */
function gardenNews(l: Learner, before: Map<string, PlantLook>, arrived: string[]): { line: string; wordId: string } | null {
  // Checked against the learner now: an answer undone after its visitor came takes the visitor away again.
  for (const id of arrived.filter((x) => broughtVisitor(l, x))) {
    const garden = l.deck.byId.get(id)?.garden;
    const v = garden && VISITORS.find((x) => x.garden === garden);
    if (v) return { line: `A ${v.gloss} came to the garden.`, wordId: id };
  }
  const opened = [...before].filter(([id, look]) => look.stage !== "bloom" && plantStage(readMemory(l, id)) === "bloom");
  for (const [id] of opened) {
    const word = l.words.get(id);
    const rare = word && rareOf(word.lemma);
    if (word && rare) return { line: `${word.lemma} opened ${RARE_NEWS[rare]}.`, wordId: id };
  }
  // "today", not "for the first time": a word known once, forgotten and learned again opens again.
  const first = opened.length ? l.words.get(opened[0][0]) : undefined;
  return first ? { line: `${first.lemma} opened today.`, wordId: first.id } : null;
}

/** This chunk's watching visitor (#210), if any: who, from which card, and the serial the chunk began at. */
function watcherFor(l: Learner, start: number): { visit: SessionVisit; view: VisitorView; start: number } | null {
  if (!growthOn()) return null; // A visitor moving in the corner is motion: it follows the setting and reduced motion.
  const garden = gardenBrought(l);
  const brought = VISITORS.filter((v) => v.garden && garden.has(v.garden) && GARDEN_VISITOR_ART[v.garden]).map((v) => v.id);
  const dayStart = startOfDay();
  const todays = l.reviews.filter((r) => Date.parse(r.reviewed_at) >= dayStart).length;
  const visit = sessionVisit(today(), todays, brought);
  return visit ? { visit, view: visitorViews([visit.id], l.lang)[0], start } : null;
}

/**
 * A visitor sitting by the card's plant while the learner practises (#210). Only a picture:
 * it takes no taps, so it never gets in the way of an answer.
 */
function Watcher({ view }: { view: VisitorView }) {
  const art = GARDEN_VISITOR_ART[visitor(view.id).garden!]!;
  const w = art.rows[0].length;
  const h = art.rows.length;
  return (
    <div className="session-watcher" aria-label={`${view.word} · ${view.gloss}`} role="img">
      <svg width={w * 2.2} height={h * 2.2} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" aria-hidden="true">
        <PixelRects art={art} />
      </svg>
    </div>
  );
}

function Summary({
  learner,
  counts,
  refusedBefore,
  practised,
  introduced,
  before,
  arrived,
  ended,
  onMore,
  onContinue,
  onExit,
  onWalk,
  firstSummary,
}: {
  learner: Learner | null;
  counts: { intros: number; answers: number };
  refusedBefore: Refused;
  practised: Set<string>;
  introduced: Set<string>;
  before: Map<string, PlantLook>;
  arrived: string[];
  ended: Ended;
  onMore: () => void;
  onContinue: () => void;
  onExit: () => void;
  onWalk: () => void;
  firstSummary: () => boolean;
}) {
  const stats = useMemo(() => (learner ? courseStats(learner) : null), [learner]);
  // Once per chunk, as its first summary opens: an Undo or Continue from here changes the counts, but also leaves the summary.
  useEffect(() => {
    if (firstSummary()) track("session_finished", { ended, answers: counts.answers, newWords: counts.intros });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const garden = useMemo(() => (learner ? gardenFromLearner(learner) : null), [learner]);
  // Enter is the main choice, unless a button has focus: then Enter presses that button (#239).
  // Paused, it is Continue: Done would drop the quick checks still to come (#254).
  const paused = ended === "user";
  useShortcut("Enter", paused ? onContinue : onExit);
  // A new word is a planted seed once it has an answer: its quick check, or "I knew it".
  // Watered: plants that were already in the garden before this session.
  const seeds = learner ? [...introduced].filter((id) => readMemory(learner, id)?.reps).length : 0;
  const watered = [...practised].filter((id) => !introduced.has(id)).length;
  const met = introduced.size - seeds;
  const did = seeds + watered > 0;
  // "I knew it" plants a seed that comes back in about a week: it is not known yet, so say what the taps did (#261).
  const knew = learner ? [...introduced].filter((id) => learner.reviewsByWord.get(id)?.some((r) => r.kind === "known")).length : 0;
  const highlight = useMemo(() => new Set([...practised, ...introduced]), [practised, introduced]);
  // News worth a look in the garden (#232), worked out once, as the summary opens.
  const [news] = useState(() => (learner ? gardenNews(learner, before, arrived) : null));
  // Worked out once, when the summary opens: later syncs update the learner, and must not start the replay again.
  const [replay] = useState(() => {
    if (!learner || !growthOn()) return null;
    const grew = [...before].flatMap(([id, from]) => {
      const read = readMemory(learner, id);
      const word = learner.words.get(id);
      if (!read || !word) return [];
      return grows({ word: word.lemma, from, to: { s: read.s, stage: plantStage(read) }, planted: false }) ? [{ id, from }] : [];
    });
    return grew.length ? grew : null;
  });
  // ?? only for the type: a summary follows a started session, so the learner has loaded.
  const [headline] = useState(() => summaryHeadline(learner?.course.lang ?? "", learner?.reviews.length ?? 0));
  const title = paused ? "Session paused" : "Session complete";
  // Live: a refusal can arrive after the summary opens, as the last answers upload.
  const refused = useRefused();
  const lost = refused.count > refusedBefore.count;
  // After a refusal, the line above the summary says what was lost: no "saved" here (#253).
  const why = paused ? (lost ? null : "Your answers are saved.") : ended === "empty" ? "Every plant has water." : null;
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
      {/* A paused session drops its promised quick checks unless the learner continues (#254). */}
      {paused && met > 0 && (
        <p>
          {met === 1
            ? "A new word is planted after its quick check. Tap Continue: its quick check comes in a few cards. If you stop, it comes back as a new word next time."
            : "New words are planted after their quick check. Tap Continue: their quick checks come in a few cards. If you stop, they come back as new words next time."}
        </p>
      )}
      <Garden data={garden} highlight={highlight} replay={replay} compact />
      {garden && seeds > 0 && garden.total === seeds && <p className="muted small first-plants">{firstPlantsLine(garden.total)}</p>}
      {/* The whole course, not this session: "so far" keeps the two apart, and "0 words" would contradict "You saw 1 new word". */}
      {stats && stats.known + stats.learning > 0 && (
        <p>
          {stats.known > 0 ? (
            <>
              You know <strong>{stats.known}</strong> {stats.known === 1 ? "word" : "words"}.{stats.learning > 0 && <> You are learning {stats.learning} more.</>}
            </>
          ) : (
            <>
              So far, you have started {stats.learning} {stats.learning === 1 ? "word" : "words"}.{knew === 0 && <> {KNOWN_RULE}</>}
            </>
          )}
        </p>
      )}
      {knew > 0 && <p className="muted">You said you already knew {plural(knew, "word")}. {knew === 1 ? "It comes" : "They come"} back in about a week. Remember {knew === 1 ? "it" : "them"} then, and {knew === 1 ? "it counts" : "they count"} as known.</p>}
      {news && (
        <p className="garden-news">
          {news.line}{" "}
          <button
            className="ghost link"
            onClick={() => {
              focusPlant(news.wordId);
              onWalk();
            }}
          >
            See it in the garden →
          </button>
        </p>
      )}
      <div className="actions">
        {/* Paused: Continue goes back to the card it left, with the time that was left; a new
            chunk on top would only confuse. Finished: 5 more minutes always works. */}
        {paused ? (
          <>
            <button className="secondary" onClick={onExit}>
              Done
            </button>
            <button className="primary" onClick={onContinue}>
              Continue this session <kbd>Enter</kbd>
            </button>
          </>
        ) : (
          <>
            <button className="secondary" onClick={onMore}>
              Practice {DAILY_MINUTES} more minutes
            </button>
            <button className="primary" onClick={onExit}>
              Done <kbd>Enter</kbd>
            </button>
          </>
        )}
      </div>
    </main>
  );
}
