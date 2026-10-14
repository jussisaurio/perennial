import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { apiMessage, moreExamples } from "../data/ai";
import { useFeatures } from "../data/server";
import { useUser } from "../data/auth";
import { recall, wordState, type MemoryRow, type WordState } from "../core/memory";
import { notStartedWords } from "../content/order";
import { setWordStatus, useLearner, useStore, type Learner, type Sentence, type Word } from "../data/learner";
import type { ReviewRow, UserSentenceRow } from "../data/rows";
import { tooFewCredits, useMe } from "./Account";
import { useNow } from "./useNow";
import { useShortcut } from "./useShortcut";
import { AddScreen } from "./Add";
import { drawnRows, FieldGuide } from "./FieldGuide";
import { StageGlyph } from "./StageGlyph";
import { PlusIcon } from "./icons";
import { plural, relTime } from "./format";
import { wordsEmptyLine } from "../content/voice";
import { headword } from "../content/forms";

type Filter = "all" | WordState | "suspended" | "mine";
const SKILL_ORDER = ["read", "listen", "write"];

/** The skills practised at least once, reading first. */
const practisedSkills = (memory: MemoryRow[]) => memory.filter((m) => m.reps > 0).sort((x, y) => SKILL_ORDER.indexOf(x.skill) - SKILL_ORDER.indexOf(y.skill));

export function WordsScreen({ lang, adding, onAdd, onBack }: { lang: string; adding: boolean; onAdd: () => void; onBack: () => void }) {
  // Adding words from a text needs Perennial AI (the server says if it is on): without it, the
  // course words in a text are few, and the rest can't be added. Hidden until it is on.
  const { ai } = useFeatures();
  if (adding && ai) return <AddScreen lang={lang} onBack={onBack} />;
  return <WordList lang={lang} onAdd={ai ? onAdd : undefined} />;
}

/**
 * Only the rows near the screen are in the DOM, so a course of 10 000 words
 * scrolls as fast as one of 10. Rows measure themselves: an open word detail
 * is taller than a closed row.
 */
function VirtualWords<T extends { l: Word }>({ rows, render }: { rows: T[]; render: (row: T) => ReactNode }) {
  const list = useRef<HTMLUListElement>(null);
  const [offset, setOffset] = useState(0);
  // Banners above the list can appear later, so keep the offset current. It
  // runs after every render on purpose, and only sets state when it moved.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const top = (list.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
    if (Math.abs(top - offset) > 1) setOffset(top);
  });
  const v = useWindowVirtualizer({ count: rows.length, estimateSize: () => 54, overscan: 8, scrollMargin: offset, getItemKey: (i) => rows[i].l.id });
  return (
    <ul className="words" ref={list} style={{ height: v.getTotalSize(), position: "relative" }}>
      {v.getVirtualItems().map((item) => (
        <li key={item.key} data-index={item.index} ref={v.measureElement} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${item.start - v.options.scrollMargin}px)` }}>
          {render(rows[item.index])}
        </li>
      ))}
    </ul>
  );
}

function WordList({ lang, onAdd }: { lang: string; onAdd?: () => void }) {
  const learner = useLearner(lang);
  const store = useStore();
  const [q, setQ] = useState("");
  const search = useRef<HTMLInputElement>(null);
  useShortcut("/", () => search.current?.focus());
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<WordsView>(savedView);
  const [open, setOpen] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<Word | null>(null);
  useEffect(() => {
    if (!deleted) return;
    const t = setTimeout(() => setDeleted(null), 7000);
    return () => clearTimeout(t);
  }, [deleted]);
  const rows = useMemo(() => {
    if (!learner) return [];
    const byWord = new Map<string, MemoryRow[]>();
    for (const m of learner.memories) byWord.set(m.wordId, [...(byWord.get(m.wordId) ?? []), m]);
    const needle = q.trim().toLocaleLowerCase();
    // "New" lists what comes next (learner.ts); "All", the whole course, so a search finds a word not started yet (#262);
    // the other filters, what you have grown.
    // Words from your own texts, newest first (user words are ranked in the order added).
    const mine = () => [...learner.words.values()].filter((w) => w.source === "user").sort((a, b) => b.rank - a.rank);
    // Every deck word can come in a session: the deck check wants 3 live sentences for each (deckProblems).
    const base = filter === "new" ? notStartedWords(learner) : filter === "mine" ? mine() : filter === "all" ? [...learner.words.values()] : learner.studied;
    return base
      .filter((l) => l.status !== "ignored")
      .map((l) => {
        const mem = byWord.get(l.id) ?? [];
        return { l, mem, state: wordState(mem.find((m) => m.skill === "read")) };
      })
      .filter(({ l, state }) => {
        if (filter === "suspended") return l.status === "paused";
        if (filter !== "all" && filter !== "mine" && state !== filter) return false;
        // The word as the list shows it, so "die katze" finds die Katze (#260).
        return !needle || headword(l, lang).toLocaleLowerCase().includes(needle) || l.gloss.toLocaleLowerCase().includes(needle) || l.forms.some((f) => f.includes(needle));
      })
      .sort((a, b) => (filter === "mine" || filter === "new" ? 0 : (a.l.rank ?? 1e9) - (b.l.rank ?? 1e9) || a.l.lemma.localeCompare(b.l.lemma)));
  }, [learner, q, filter, lang]);
  // The flowers view draws only words that have started growing; the count says what is on screen.
  const shown = useMemo(() => (view === "guide" ? drawnRows(rows) : rows), [view, rows]);
  // "From my texts" only where it can have words: adding is on, or some were added before (#262).
  const hasMine = useMemo(() => !!learner && [...learner.words.values()].some((w) => w.source === "user"), [learner]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Words</h1>
        {onAdd && (
          <button className="primary" onClick={onAdd}>
            <PlusIcon size={18} /> Add words
          </button>
        )}
      </div>
      <div className="row">
        <input ref={search} className="search" type="search" placeholder="Search words or meanings (/)" aria-keyshortcuts="/" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label="Which words">
          <option value="all">All</option>
          <option value="known">Known</option>
          <option value="learning">Learning</option>
          <option value="new">New</option>
          <option value="suspended">Paused</option>
          {(onAdd || hasMine) && <option value="mine">From my texts</option>}
        </select>
      </div>
      <div className="chips words-view" role="radiogroup" aria-label="Show words as">
        {(["list", "guide"] as const).map((v) => (
          <button
            key={v}
            role="radio"
            aria-checked={view === v}
            className={view === v ? "chip on" : "chip"}
            onClick={() => {
              // A word open in one view must not pop up in the other.
              setOpen(null);
              setView(v);
              saveView(v);
            }}
          >
            {v === "list" ? "List" : "Flowers"}
          </button>
        ))}
      </div>
      <p className="muted small">{plural(shown.length, "word")}</p>
      {learner && rows.length === 0 && <p className="words-empty">{wordsEmptyLine(filter, !!q.trim())}</p>}
      {learner && rows.length > 0 && shown.length === 0 && <p className="words-empty">Words you have not started yet have no flower to show. They are in the List.</p>}
      {view === "guide" ? (
        <FieldGuide
          lang={lang}
          rows={shown}
          open={open}
          onOpen={setOpen}
          detail={({ l, mem }) =>
            learner && (
              <WordDetail
                learner={learner}
                word={l}
                memory={mem}
                onDeleted={() => {
                  setOpen(null);
                  setDeleted(l);
                }}
              />
            )
          }
        />
      ) : (
        <VirtualWords
          rows={rows}
          render={({ l, mem }) => (
            <>
              <button className="word-row" onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>
                <StageGlyph s={mem.find((m) => m.skill === "read")?.s ?? 0} reps={mem.find((m) => m.skill === "read")?.reps ?? 0} suspended={l.status === "paused"} />
                <strong>{headword(l, lang)}</strong>
                <span className="gl">{l.gloss}</span>
                {/* The skills practised, without a recall number: unlabelled, it read as a score (#262). The number is in Scheduling details. */}
                <span className="skills">
                  {practisedSkills(mem).map((m) => (
                    <span key={m.skill} className={`pip ${m.skill}`}>
                      {m.skill}
                    </span>
                  ))}
                </span>
              </button>
              {open === l.id && learner && <WordDetail learner={learner} word={l} memory={mem} onDeleted={() => setDeleted(l)} />}
            </>
          )}
        />
      )}
      {deleted && (
        <div className="toast" role="status">
          {deleted.source === "deck" ? `“${deleted.lemma}” will not come up again.` : `Deleted “${deleted.lemma}”. Goodbye, little plant.`}
          {deleted.source === "deck" && (
            <button
              className="ghost"
              onClick={() => {
                void setWordStatus(store, deleted.id, "active");
                setDeleted(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type WordsView = "list" | "guide";
// Which view the learner last chose: a per-device convenience, so storage may be missing.
const VIEW_KEY = "words-view";
function savedView(): WordsView {
  try {
    return localStorage.getItem(VIEW_KEY) === "guide" ? "guide" : "list";
  } catch {
    return "list"; // No storage: the list, the default.
  }
}
function saveView(v: WordsView): void {
  try {
    localStorage.setItem(VIEW_KEY, v);
  } catch {
    // Not saved; it still applies until the screen closes.
  }
}

const SKILL_NAME: Record<string, string> = { read: "Reading", listen: "Listening", write: "Writing" };

/** Who wrote a sentence, in plain words. */
function authorLabel(e: Sentence): string {
  if (e.origin === "own-text") return "From your text";
  if (e.origin === "ai") return "Written for you by Perennial AI";
  return "From the course";
}

/** "Write new sentences" with Perennial AI, with the cost shown first and an undo after. */
function RewriteButton({ learner, word }: { learner: Learner; word: Word }) {
  const { ai } = useFeatures();
  const store = useStore();
  const { user } = useUser();
  const { me, refresh } = useMe();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  if (!ai) return null; // Not on this server (data/server.ts).
  if (!user || user.anonymous) return <span className="muted small">Add your email in Settings to have Perennial AI write new sentences.</span>;
  const none = tooFewCredits(me, 1);
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const seen = learner.sentences(word.id).map((s) => s.text).slice(-6);
      const known = learner.studied.slice(0, 400).map((w) => w.lemma);
      const r = await moreExamples(learner.lang, [{ lemma: word.lemma, gloss: word.gloss, seen }], known);
      const rows: UserSentenceRow[] = r.examples
        .filter((e) => e.text.includes(e.cloze) && e.cloze.length < e.text.length)
        .map((e) => ({ id: crypto.randomUUID(), user_id: store.userId, word_id: word.id, text: e.text, translation: e.translation, cloze: e.cloze, origin: "ai", model: r.model, created_at: new Date().toISOString() }));
      await store.write(() => {
        for (const row of rows) store.collections.user_sentence.insert(row as UserSentenceRow & Record<string, unknown>);
      });
      setDone(rows.map((row) => row.id));
    } catch (e) {
      setError(apiMessage(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };
  if (done)
    return (
      <span className="small">
        {done.length ? `Wrote ${plural(done.length, "new sentence")}.` : "No new sentences this time."}{" "}
        <button
          className="ghost"
          onClick={() => {
            void store.write(() => {
              for (const id of done) if (store.collections.user_sentence.has(id)) store.collections.user_sentence.delete(id);
            });
            setDone(null);
          }}
        >
          Undo
        </button>
      </span>
    );
  return (
    <span className="row">
      <button className="secondary" disabled={busy || none} onClick={() => void run()}>
        {busy ? "Writing…" : "Write new sentences"}
      </button>
      <span className="muted small">With Perennial AI · uses 1 AI word{none ? " (you have none left this month)" : ""}. The course sentences stay.</span>
      {error && <span className="error">{error}</span>}
    </span>
  );
}

function WordDetail({ learner, word, memory, onDeleted }: { learner: Learner; word: Word; memory: MemoryRow[]; onDeleted: () => void }) {
  const store = useStore();
  const now = useNow();
  const examples = learner.sentences(word.id);
  const mine = word.source === "user";
  const [gloss, setGloss] = useState(word.gloss);
  const [notes, setNotes] = useState(word.notes ?? "");
  const [saved, setSaved] = useState(false);
  const save = async () => {
    if (!mine || (gloss === word.gloss && notes === (word.notes ?? ""))) return;
    await store.write(() =>
      store.collections.user_word.update(word.id, (d) => {
        d.gloss = gloss;
        d.notes = notes || null;
      }),
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  const paused = word.status === "paused";
  const practised = practisedSkills(memory);

  return (
    <div className="detail">
      {mine ? (
        <div className="form">
          {saved && <span className="ok small">Saved ✓</span>}
          <label>
            Meaning
            <input value={gloss} onChange={(e) => setGloss(e.target.value)} onBlur={() => void save()} />
          </label>
          <label>
            Note
            <input value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => void save()} placeholder="optional" />
          </label>
        </div>
      ) : (
        word.notes && <p className="muted small">{word.notes}</p>
      )}
      {practised.length ? (
        <ul className="schedule">
          {practised.map((m) => (
            <li key={m.skill}>
              <strong>{SKILL_NAME[m.skill]}:</strong> next review {m.due <= now ? "now" : relTime(m.due)} · {plural(m.reps, "review")}
              {m.lapses > 0 && ` · missed ${plural(m.lapses, "time")}`}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Not started. It will come in a session as a new word.</p>
      )}
      {practised.length > 0 && <SchedulingDetails practised={practised} reviews={learner.reviewsByWord.get(word.id) ?? []} now={now} />}
      <ul className="examples">
        {examples.map((e) => (
          <li key={e.id}>
            <span>{e.text}</span> <span className="muted">— {e.translation}</span>
            <span className="author">{authorLabel(e)}</span>
            {e.origin !== "deck" && (
              <button className="ghost small" onClick={() => void store.write(() => store.collections.user_sentence.delete(e.id))} aria-label="Remove sentence">
                remove
              </button>
            )}
          </li>
        ))}
      </ul>
      <RewriteButton learner={learner} word={word} />
      <div className="row">
        <button className="secondary" onClick={() => void setWordStatus(store, word.id, paused ? "active" : "paused")}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          className="ghost"
          onClick={() => {
            if (mine) void store.write(() => store.collections.user_word.delete(word.id));
            else void setWordStatus(store, word.id, "ignored");
            onDeleted();
          }}
        >
          {mine ? "Delete" : "Never show this word"}
        </button>
        {paused ? (
          <span className="muted small">Paused. It does not appear in sessions.</span>
        ) : (
          !mine && <span className="muted small">Pause: it stays out of sessions until you resume it. Never show: it leaves your course.</span>
        )}
      </div>
    </div>
  );
}

const GRADE: Record<number, string> = { 1: "forgot", 2: "hard", 3: "remembered", 4: "easy" };

/** The numbers behind the schedule (FSRS), for learners who want them. */
function SchedulingDetails({ practised, reviews, now }: { practised: MemoryRow[]; reviews: ReviewRow[]; now: number }) {
  return (
    <details className="more scheduling">
      <summary>Scheduling details</summary>
      <table className="small">
        <thead>
          <tr>
            <th>Skill</th>
            <th title="Days until the chance of remembering falls to 90%">Stability</th>
            <th title="1 (easy) to 10 (hard)">Difficulty</th>
            <th title="The chance you remember it now">Recall now</th>
          </tr>
        </thead>
        <tbody>
          {practised.map((m) => (
            <tr key={m.skill}>
              <td>{SKILL_NAME[m.skill]}</td>
              <td>{m.s < 1 ? `${Math.round(m.s * 24)} h` : plural(Math.round(m.s), "day")}</td>
              <td>{m.d.toFixed(1)}</td>
              <td>{Math.round(recall(m, now) * 100)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="review-log small">
        {[...reviews]
          .sort((a, b) => b.reviewed_at.localeCompare(a.reviewed_at))
          .map((r) => (
            <li key={r.id}>
              <time dateTime={r.reviewed_at}>{new Date(r.reviewed_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time> · {SKILL_NAME[r.skill]} ·{" "}
              {r.kind === "known" ? "marked as known" : GRADE[r.grade]}
            </li>
          ))}
      </ul>
    </details>
  );
}
