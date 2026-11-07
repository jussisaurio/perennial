import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { didLine, firstPlantsLine } from "../content/voice";
import { check, differences, passes, type Verdict } from "../core/answer";
import type { Grade } from "../core/fsrs";
import { askedForm, headword, otherForm } from "../content/forms";
import { locate } from "../content/text";
import type { Learner, Word } from "../data/learner";
import type { DeckSentences } from "../data/deck";
import { Garden, gardenFromLearner } from "./Garden";
import { BookIcon, CloseIcon, EarIcon, PenIcon, SeedIcon, SnailIcon, SpeakerIcon, UndoIcon } from "./icons";
import { rareOf, WordPlant, type Rare } from "./plant";
import { chimeDelay, Growth, growthOn, GrowthToggle, grows, useGrowthSetting, type GrowthMoment, type PlantLook } from "./Growth";
import { chime } from "./chime";
import { speak, speakAll, speakSlowly, stopSpeaking } from "./speech";
import { SoundToggle, useSound } from "./Sound";
import { courseStats } from "./stats";
import { useSessionRunner, type Card, type Ended } from "./useSessionRunner";
import { RefusedLine, useRefused } from "./Refused";
import type { Refused } from "../data/store";
import { useKeys, useShortcut } from "./useShortcut";
import { afterPaint } from "./afterPaint";
import { track } from "../observability";
import { chunkLabel, DAILY_MINUTES } from "../data/practice";
import { KNOWN_RULE, plantStage, readMemory } from "../core/memory";
import { plural } from "./format";
import { focusPlant } from "./gardenFocus";
import { readNow } from "../data/reading";
import { language } from "../content/languages";
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

/** The sentence with its card's word marked (or blanked), and the learner's grown words (`grown`, from data/reading.ts) tinted. */
function Highlight({ text, part, blank, grown = [] }: { text: string; part: string; blank?: boolean; grown?: readonly [number, number][] }) {
  const i = locate(text, part);
  const cuts = [...grown.filter(([s, e]) => i < 0 || e <= i || s >= i + part.length).map(([s, e]) => ({ s, e, grown: true })), ...(i < 0 ? [] : [{ s: i, e: i + part.length, grown: false }])].sort((a, b) => a.s - b.s);
  let at = 0;
  const out: ReactNode[] = [];
  for (const c of cuts) {
    out.push(text.slice(at, c.s));
    const piece = text.slice(c.s, c.e);
    out.push(
      c.grown ? (
        <span className="grown" key={c.s}>
          {piece}
        </span>
      ) : blank ? (
        <span className="blank" key={c.s}>
          {" ".repeat(Math.max(4, [...part].length))}
        </span>
      ) : (
        <mark key={c.s}>{piece}</mark>
      ),
    );
    at = c.e;
  }
  out.push(text.slice(at));
  return <>{out}</>;
}

/** How many answers the learner gives before the quick-check hint stops showing. */
const HINT_ANSWERS = 3;

/** Fewer than `n` answers in the log. It stops counting at `n`: the session asks each second, and the log grows long. */
function fewerAnswers(reviewsByWord: Learner["reviewsByWord"], n: number): boolean {
  let answers = 0;
  for (const list of reviewsByWord.values()) for (const r of list) if (r.kind === "review" && ++answers >= n) return false;
  return true;
}

/** Where the moment after an answer starts and is drawn: see `answer`. */
interface Answered {
  corner: DOMRect;
  spot: DOMRect;
}

export function SessionScreen({ lang, onExit, onWalk, minutes }: { lang: string; onExit: () => void; onWalk: () => void; minutes: number }) {
  const [help, setHelp] = useState(false);

  // The word's plant is planted or grows before the next card (#200).
  const [growing, setGrowing] = useState<{ m: GrowthMoment; at: Answered } | null>(null);
  const cornerPlant = useRef<HTMLDivElement>(null);
  const growthSpot = useRef<HTMLDivElement>(null);
  const grown = useRef<(() => void) | null>(null);
  // Where the answered card's plant is (the moment starts from it), and where the moment
  // is drawn. Read as the answer comes, while the layout is fresh; read after the answer's
  // render, they force a layout (#457, #572).
  const answeredAt = useRef<Answered | null>(null);
  const answer = (g: Grade | null, o?: { alreadyKnown?: boolean }) => {
    answeredAt.current = { corner: cornerPlant.current!.firstElementChild!.getBoundingClientRect(), spot: growthSpot.current!.getBoundingClientRect() };
    void finish(g, o);
  };
  // Every remembered answer is watered, even when the plant barely grows (a retry
  // after "I forgot" adds little): the learner sees the answer counted.
  const grow = (m: GrowthMoment) => {
    return new Promise<void>((resolve) => {
      grown.current = () => {
        grown.current = null;
        setGrowing(null);
        resolve();
      };
      setGrowing({ m, at: answeredAt.current! });
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

  const { learner, sentences, tag, runner, card, done, active, ended, refusedBefore, serial, canUndo, start, finish, undo, exit, resume, firstSummary } = useSessionRunner({
    lang,
    minutes,
    onExit,
    grow,
  });

  // Sometimes a visitor the learner has brought comes to watch this chunk (#210). Worked
  // out when a chunk starts (a new runner), from the learner as it is then.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per chunk, not on every answer
  const watching = useMemo(() => (runner && learner ? watcherFor(learner, serial) : null), [runner]);
  // Turned off in the session bar: the watching visitor leaves now; the next answer has no moment.
  const [growth] = useGrowthSetting();

  useKeys({ z: () => void undo(), "Mod+z": () => void undo(), Escape: () => (help ? setHelp(false) : exit()), "?": () => setHelp((h) => !h) });

  if (!runner) return <div className="session center muted">Preparing…</div>;

  // The quick-check hint is for a learner's first few answers; after that it is noise (#270).
  const hint = !!learner && fewerAnswers(learner.reviewsByWord, HINT_ANSWERS);

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
        <SoundToggle tip />
        <GrowthToggle />
        <button className="undo" onClick={() => void undo()} disabled={!canUndo} title="Undo last answer (Z)" aria-keyshortcuts="Z Control+Z Meta+Z">
          <UndoIcon size={18} /> Undo <kbd aria-hidden="true">Z</kbd>
        </button>
      </header>
      {/* During the session and on its summary: in place, never over the answer buttons. */}
      <RefusedLine since={refusedBefore} />
      {done ? (
        <Summary learner={learner} sentences={sentences}{...done} refusedBefore={refusedBefore} ended={ended} onMore={() => void start(DAILY_MINUTES)} onContinue={resume} onExit={onExit} onWalk={onWalk} firstSummary={firstSummary} />
      ) : card ? (
        // The card's plant stands on the kicker's row, so it moves with the card when a line above pushes it down.
        <div className="card-stage">
          <CardView key={serial} card={card} tag={tag} lang={lang} hint={hint} onDone={answer} />
          <div className="card-plant" ref={cornerPlant} key={`plant-${serial}`} aria-hidden="true">
            <WordPlant word={card.word.lemma} s={card.s} stage={card.stage} size={76} />
          </div>
          {growth && watching && serial - watching.start >= watching.visit.from - 1 && serial - watching.start < watching.visit.to - 1 && <Watcher view={watching.view} />}
        </div>
      ) : null}
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
      {/* ?.: a tap may already have ended the moment. */}
      {growing && <Growth m={growing.m} corner={growing.at.corner} spot={growing.at.spot} onDone={() => grown.current?.()} />}
      <div className="growth-spot" ref={growthSpot} />
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

/** Speaker buttons. Their names say what they play, so a screen reader can tell them apart (#266). A sentence can also play slowly. */
function Speaker({ text, tag, what }: { text: string; tag: string; what: "word" | "sentence" }) {
  const [sound] = useSound();
  if (!sound) return null;
  return (
    <span className="speaker">
      <button onClick={() => void speak(text, tag)} aria-label={`Play the ${what}`} title={`Play the ${what}`}>
        <SpeakerIcon size={18} />
      </button>
      {what === "sentence" && (
        <button onClick={() => void speakSlowly(text, tag)} aria-label="Play the sentence slowly" title="Play the sentence slowly">
          <SnailIcon size={18} />
        </button>
      )}
    </span>
  );
}

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
        {word.pos && <span className="pos">{word.pos}</span>}{" "}
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

/** Two presses this close together are one double-click or double-tap. */
const DOUBLE_TAP_MS = 400;

/** A click, or the Enter that submits a form. */
type Press = MouseEvent<HTMLElement> | FormEvent;

/** Where a press landed: a box on the screen, or "key" for a key (a click from a key has detail 0). */
function placeOf(e: Press): DOMRect | "key" {
  return "detail" in e && e.detail > 0 ? e.currentTarget.getBoundingClientRect() : "key";
}

/** Whether press `e` landed on `place`, where Show was pressed. */
function samePlace(place: DOMRect | "key", e: Press) {
  if (place === "key") return placeOf(e) === "key";
  if (!("clientX" in e) || e.detail === 0) return false;
  return e.clientX >= place.left && e.clientX <= place.right && e.clientY >= place.top && e.clientY <= place.bottom;
}

/**
 * A card's answer, hidden until shown. "Show" sits where the answer buttons
 * appear, so the second half of a double-click or double-tap on it would
 * answer a card nobody has read. So the first answer press is dropped when it
 * comes that soon after Show and lands where Show was. Every other press
 * counts at once, so the buttons never look or act held back. The answer keys
 * (1, 2, arrows) differ from the keys that show the answer, so they always count.
 */
function useReveal() {
  const [revealed, setRevealed] = useState(false);
  const shown = useRef<{ at: number; place: DOMRect | "key" } | null>(null);
  // A shortcut key passes no event: its answer keys are other keys, so no answer press can be its second half.
  const reveal = (e?: Press) => {
    shown.current = e ? { at: e.timeStamp, place: placeOf(e) } : null;
    setRevealed(true);
  };
  const guarded = (answer: () => void) => (e: Press) => {
    const show = shown.current;
    shown.current = null;
    if (show && e.timeStamp - show.at < DOUBLE_TAP_MS && samePlace(show.place, e)) return;
    answer();
  };
  return { revealed, reveal, guarded };
}

/**
 * What a screen reader says as a card comes or its answer shows (#257). This
 * hidden line takes focus, so it is read once, from one place (no live region
 * saying it again), and Tab goes on into the card. Without it, focus drops to
 * the page when the pressed button goes away. A new `step` (the answer shown)
 * focuses the line again, so it is read again. The node stays: removing the
 * focused node makes the browser look for focus anew (#572).
 */
function Said({ step, children }: { step?: string; children: ReactNode }) {
  const line = useRef<HTMLParagraphElement>(null);
  // After the paint: focus brings style and layout up to date, half of the key press's task when done in it (#457).
  useEffect(() => {
    // The element, not the ref, goes to the timer: on unmount React clears the ref first and cancels the timer
    // later, in this effect's cleanup, and a non-urgent render (or a test clock) can fire the timer between the two.
    // Focus on an element that left the page does nothing.
    const el = line.current!;
    // Until then, a key must not press a button that kept focus ("End session" pressed with Enter): keys are the screen's shortcuts.
    // The line itself keeps focus until then: a key on it does nothing, and a blur here would bring style up to date in the key press's task.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== el) active.blur();
    return afterPaint(() => {
      // Focus again, so a screen reader reads the new step: focusing the focused line says nothing.
      if (document.activeElement === el) el.blur();
      el.focus({ preventScroll: true });
    });
  }, [step]);
  return (
    <p className="said sr-only" tabIndex={-1} ref={line}>
      {children}
    </p>
  );
}

/** The meaning as the screen shows it, said in one line: the class set apart, not run into the meaning. */
function MeaningLine({ word, lang, tag, asked }: { word: Word; lang: string; tag: string; asked?: string }) {
  const form = asked && otherForm(word, asked);
  const head = <span lang={tag}>{headword(word, lang)}</span>;
  return (
    <>
      {head}
      {word.pos && `, ${word.pos}`}: {word.gloss}.
      {form && (
        <>
          {" "}
          <span lang={tag}>{form}</span> is a form of {head}.
        </>
      )}
    </>
  );
}

// The meaning stays hidden until the learner has tried to recall it: once an
// answer is in view, "I knew it" is too easy to believe (#196).
function Intro({ card, tag, lang, onDone }: { card: Card; tag: string; lang: string; onDone: (g: Grade | null, o?: { alreadyKnown?: boolean }) => void }) {
  const { word, example } = card;
  const { revealed, reveal, guarded } = useReveal();
  const play = useCallback(() => void speakAll(example ? [word.lemma, example.text] : [word.lemma], tag), [word.lemma, example, tag]);
  // The sentence follows the word; leaving the card cuts both off, so it never plays over the next one.
  useEffect(() => {
    play();
    return stopSpeaking;
  }, [play]);
  const isNewNow = () => onDone(null);
  const knewItNow = () => onDone(null, { alreadyKnown: true });
  const isNew = guarded(isNewNow);
  const knewIt = guarded(knewItNow);
  // Answers are always 1 / ← (the left button) and 2 / → (the right one).
  useKeys(revealed ? { "1": isNewNow, ArrowLeft: isNewNow, "2": knewItNow, ArrowRight: knewItNow, r: play } : { " ": () => reveal(), Enter: () => reveal(), r: play });
  return (
    <main className="card">
      <Said step={revealed ? "answer" : "question"}>
        {revealed ? (
          <>
            <MeaningLine word={word} lang={lang} tag={tag} /> Is this word new to you?
          </>
        ) : (
          <>
            New word: <span lang={tag}>{headword(word, lang)}</span>.
          </>
        )}
      </Said>
      <Kicker kind="intro" />
      <div className="word">
        {headword(word, lang)} <Speaker text={word.lemma} tag={tag} what="word" />
      </div>
      {revealed && (
        <div className="gloss">
          {word.pos && <span className="pos">{word.pos}</span>}{" "}
          {word.gloss}
        </div>
      )}
      {revealed && word.notes && <p className="hint">{word.notes}</p>}
      {example && (
        <div className="example">
          <p className="sentence" lang={tag}>
            <Highlight text={example.text} part={example.cloze} grown={revealed ? card.grown : undefined} /> <Speaker text={example.text} tag={tag} what="sentence" />
          </p>
          {revealed && <p className="translation">{example.translation}</p>}
        </div>
      )}
      {revealed ? (
        <div className="question">
          <p className="prompt">Is this word new to you?</p>
          <div className="answers">
            <button className="answer-btn primary" onClick={isNew} aria-keyshortcuts="1">
              <strong>
                New to me <kbd aria-hidden="true">1</kbd>
              </strong>
              <span>Learn it now. A quick check comes in a moment.</span>
            </button>
            <button className="answer-btn" onClick={knewIt} aria-keyshortcuts="2">
              <strong>
                I knew it <kbd aria-hidden="true">2</kbd>
              </strong>
              <span>Skip the quick check. Back in about a week.</span>
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="prompt">Do you know what it means? Think first, then look.</p>
          <Actions>
            <button className="primary wide" onClick={reveal} aria-keyshortcuts="Space">
              Show meaning <kbd aria-hidden="true">Space</kbd>
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
  const { revealed, reveal, guarded } = useReveal();
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
      ? { "1": () => onDone(1), ArrowLeft: () => onDone(1), "2": () => onDone(3), ArrowRight: () => onDone(3), r: play }
      : { " ": () => reveal(), Enter: () => reveal(), r: play },
  );
  // Grades are about the word; on a listening card that means "did I catch it".
  const [no, yes] = listen ? ["Did not understand", "Understood"] : ["I forgot", "I remembered"];
  return (
    <main className="card" data-lemma={word.lemma}>
      <Said step={revealed ? "answer" : "question"}>
        {revealed ? (
          <>
            {example && `${example.translation} `}
            <MeaningLine word={word} lang={lang} tag={tag} asked={asked} />
          </>
        ) : listen ? (
          // The sentence is only heard here, so the line leaves it out.
          "Listen. What does the sentence mean?"
        ) : (
          <>
            {example && <span lang={tag}>{example.text} </span>}
            What does <span lang={tag}>{asked}</span> mean?
          </>
        )}
      </Said>
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
        <div className="listen-play">
          <button className="play" onClick={play} aria-label="Play again">
            <SpeakerIcon size={34} />
          </button>
          <button className="ghost" onClick={() => void speakSlowly(audioText, tag)}>
            <SnailIcon size={18} /> slower
          </button>
        </div>
      ) : example ? (
        <p className="sentence big" lang={tag}>
          <Highlight text={example.text} part={example.cloze} grown={revealed ? card.grown : undefined} />
          <Speaker text={example.text} tag={tag} what="sentence" />
        </p>
      ) : (
        <div className="word">
          {word.lemma} <Speaker text={word.lemma} tag={tag} what="word" />
        </div>
      )}
      {revealed ? (
        <>
          <div className="reveal">
            {example && <p className="translation">{example.translation}</p>}
            <Meaning word={word} lang={lang} asked={asked} />
          </div>
          <Actions>
            <button className="fail" onClick={guarded(() => onDone(1))} aria-keyshortcuts="1">
              {no} <kbd aria-hidden="true">1</kbd>
            </button>
            <button className="pass" onClick={guarded(() => onDone(3))} aria-keyshortcuts="2">
              {yes} <kbd aria-hidden="true">2</kbd>
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
          <button className="primary wide" onClick={reveal} aria-keyshortcuts="Space">
            Show answer <kbd aria-hidden="true">Space</kbd>
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
  const ids = useId();
  const grade: Grade = verdict && passes(verdict) ? 3 : 1;
  // Checking shows the answer: Enter pressed twice must not also move on past it.
  const { reveal, guarded } = useReveal();

  const submit = (e: Press) => {
    if (verdict) {
      guarded(() => onDone(grade))(e);
      return;
    }
    setVerdict(check(value, target, lang));
    reveal(e);
    void speak(example?.text ?? word.lemma, tag);
  };

  return (
    <main className="card">
      <Kicker kind={kicker} />
      <p className="prompt">Type the missing word.</p>
      {example ? (
        <>
          <p className="translation big" id={`${ids}-ask`}>
            {example.translation}
          </p>
          <p className="sentence" lang={tag}>
            <Highlight text={example.text} part={example.cloze} blank={!verdict} grown={verdict ? card.grown : undefined} />
          </p>
          <p className="hint">Meaning: {word.gloss}</p>
        </>
      ) : (
        <div className="word" id={`${ids}-ask`}>
          {word.gloss}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(e);
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
          // Focus starts here, so the field says the task (#257).
          aria-label="Type the missing word"
          aria-describedby={`${ids}-ask`}
        />
      </form>
      {/* Focus stays in the field, where Enter checks and moves on, so the result is read from here (#257). */}
      <p className="sr-only" aria-live="polite">
        {verdict === "exact" ? "Correct." : verdict && passes(verdict) ? <>Counted as correct. The answer is <span lang={tag}>{target}</span>.</> : verdict && <>Correct answer: <span lang={tag}>{target}</span>.</>}
      </p>
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
        <button className={verdict && passes(verdict) ? "pass" : "primary"} onClick={submit} aria-keyshortcuts="Enter">
          {verdict ? "Next" : "Check"} <kbd aria-hidden="true">Enter</kbd>
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
  ["Z", "Undo the last answer. Ctrl+Z and Cmd+Z work too."],
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
/** Read-now sentences shown on this device, per language, and the day of the last one. */
const READ_KEY = (lang: string) => `perennial-read-now:${lang}`;

/**
 * Today's sentence to read, if one fits and none was shown today. Shown ones are
 * kept on this device; without storage a sentence may come again, which is harmless.
 */
function readingToday(l: Learner, sentences: DeckSentences, practised: ReadonlySet<string>): (ReturnType<typeof readNow> & { tag: string }) | null {
  const key = READ_KEY(l.lang);
  let saved: { day: string; ids: string[] } = { day: "", ids: [] };
  try {
    saved = JSON.parse(localStorage.getItem(key) ?? "null") ?? saved;
  } catch {
    // No storage, or an unreadable value: as if nothing was shown yet.
  }
  if (saved.day === today()) return null;
  const tag = language(l.lang).tag;
  const s = readNow(l, sentences, practised, new Set(saved.ids));
  if (!s) return null;
  try {
    localStorage.setItem(key, JSON.stringify({ day: today(), ids: [...saved.ids, s.id] }));
  } catch {
    // Not saved: it may show again on this device.
  }
  return { ...s, tag };
}

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
  const todays = l.reviewsSince(dayStart).length;
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
  sentences,
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
  sentences: DeckSentences | null;
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
  // A sentence the learner can now read whole (#412): once a day, never on a paused session.
  const [reading] = useState(() => (learner && sentences && !paused ? readingToday(learner, sentences, practised) : null));
  const [english, setEnglish] = useState(false);
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
  const title = paused ? "Session paused" : "Session complete";
  // Live: a refusal can arrive after the summary opens, as the last answers upload.
  const refused = useRefused();
  const lost = refused.count > refusedBefore.count;
  // After a refusal, the line above the summary says what was lost: no "saved" here (#253).
  const why = paused ? (lost ? null : "Your answers are saved.") : ended === "empty" ? "Every plant has water." : null;
  const line = did ? didLine(seeds, watered) : met > 0 ? `You saw ${plural(met, "new word")}.` : "Nothing was planted or watered.";
  return (
    <main className="card summary">
      {/* Focused once, as the summary opens; a later change to the line updates it in place and is not said again. */}
      <Said>
        {title}. {line}
      </Said>
      <div className="kicker read">
        <SeedIcon size={15} /> {title.toLowerCase()}
      </div>
      <h1>{line}</h1>
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
              You know <strong>{stats.known}</strong> {stats.known === 1 ? "word" : "words"}
              {stats.knownToday > 0 && <>, {stats.knownToday} more than this morning</>}.{stats.learning > 0 && <> You are learning {stats.learning} more.</>}
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
            See it in the garden <span aria-hidden="true">→</span>
          </button>
        </p>
      )}
      {reading && (
        <div className="read-now">
          <p className="muted small">You can read this now.</p>
          <p className="sentence" lang={reading.tag}>
            {reading.text} <Speaker text={reading.text} tag={reading.tag} what="sentence" />
          </p>
          {english ? (
            <p className="translation">{reading.translation}</p>
          ) : (
            <button className="ghost link" onClick={() => setEnglish(true)}>
              Show English
            </button>
          )}
        </div>
      )}
      <div className="actions">
        {/* Paused: Continue goes back to the card it left, with the time that was left; a new
            chunk on top would only confuse. Finished: Practice more always works. */}
        {paused ? (
          <>
            <button className="secondary" onClick={onExit}>
              Done
            </button>
            <button className="primary" onClick={onContinue} aria-keyshortcuts="Enter">
              Continue this session <kbd aria-hidden="true">Enter</kbd>
            </button>
          </>
        ) : (
          <>
            <button className="secondary" onClick={onMore}>
              {chunkLabel({ state: "done" })}
            </button>
            <button className="primary" onClick={onExit} aria-keyshortcuts="Enter">
              Done <kbd aria-hidden="true">Enter</kbd>
            </button>
          </>
        )}
      </div>
    </main>
  );
}
