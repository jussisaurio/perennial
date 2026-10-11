import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { db, write } from "../db/db";
import type { Course, Example, Lexeme, MemoryRow } from "../model";
import { currentAuthor, type Author } from "../ai/backend";
import { rewriteExamples, undoRewrite, type Rewrite } from "../content/builder";
import { hostedMessage, refreshMe } from "../hosted/api";
import { useAccount } from "./Account";
import { AddScreen } from "./Add";
import { StageGlyph } from "./Garden";
import { PlusIcon } from "./icons";
import { plural, relTime } from "./format";
import { recall, wordState, type WordState } from "./stats";

type Filter = "all" | WordState | "suspended";
const SKILL_ORDER = ["read", "listen", "write"];

export function WordsScreen({ course, adding, onAdd, onBack }: { course: Course; adding: boolean; onAdd: () => void; onBack: () => void }) {
  if (adding) return <AddScreen course={course} onBack={onBack} />;
  return <WordList course={course} onAdd={onAdd} />;
}

/**
 * Only the rows near the screen are in the DOM, so a course of 10 000 words
 * scrolls as fast as one of 10. Rows measure themselves: an open word detail
 * is taller than a closed row.
 */
function VirtualWords<T extends { l: Lexeme }>({ rows, render }: { rows: T[]; render: (row: T) => ReactNode }) {
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

function WordList({ course, onAdd }: { course: Course; onAdd: () => void }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<Lexeme | null>(null);
  useEffect(() => {
    if (!deleted) return;
    const t = setTimeout(() => setDeleted(null), 7000);
    return () => clearTimeout(t);
  }, [deleted]);
  const lexemes = useLiveQuery(() => db.lexemes.where("courseId").equals(course.id).toArray(), [course.id]);
  const memory = useLiveQuery(() => db.memory.where("courseId").equals(course.id).toArray(), [course.id]);

  const rows = useMemo(() => {
    if (!lexemes || !memory) return [];
    const byLex = new Map<string, MemoryRow[]>();
    for (const m of memory) byLex.set(m.lexemeId, [...(byLex.get(m.lexemeId) ?? []), m]);
    const needle = q.trim().toLocaleLowerCase();
    return lexemes
      .filter((l) => !l.deleted && l.status !== "ignored")
      .map((l) => {
        const mem = byLex.get(l.id) ?? [];
        return { l, mem, state: wordState(mem.find((m) => m.skill === "read")) };
      })
      .filter(({ l, state }) => {
        if (filter === "suspended") return l.status === "suspended";
        if (filter !== "all" && state !== filter) return false;
        return !needle || l.lemma.toLocaleLowerCase().includes(needle) || l.gloss.toLocaleLowerCase().includes(needle) || l.forms.some((f) => f.includes(needle));
      })
      .sort((a, b) => (a.l.rank ?? 1e9) - (b.l.rank ?? 1e9) || a.l.lemma.localeCompare(b.l.lemma));
  }, [lexemes, memory, q, filter]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Words</h1>
        <button className="primary" onClick={onAdd}>
          <PlusIcon size={18} /> Add words
        </button>
      </div>
      <div className="row">
        <input className="search" placeholder="Search words or meanings" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">All</option>
          <option value="known">Known</option>
          <option value="learning">Learning</option>
          <option value="new">New</option>
          <option value="suspended">Paused</option>
        </select>
      </div>
      <p className="muted small">{plural(rows.length, "word")}</p>
      <VirtualWords
        rows={rows}
        render={({ l, mem }) => (
          <>
            <button className="word-row" onClick={() => setOpen(open === l.id ? null : l.id)} aria-expanded={open === l.id}>
              <StageGlyph s={mem.find((m) => m.skill === "read")?.s ?? 0} reps={mem.find((m) => m.skill === "read")?.reps ?? 0} suspended={l.status === "suspended"} />
              <strong>{l.lemma}</strong>
              <span className="gl">{l.gloss}</span>
              <span className="skills">
                {mem
                  .filter((m) => m.reps > 0)
                  .sort((x, y) => SKILL_ORDER.indexOf(x.skill) - SKILL_ORDER.indexOf(y.skill))
                  .map((m) => (
                    <span key={m.skill} className={`pip ${m.skill}`} title={`${m.skill}: ${Math.round(recall(m) * 100)}% recall`}>
                      {m.skill} {Math.round(recall(m) * 100)}%
                    </span>
                  ))}
              </span>
            </button>
            {open === l.id && <WordDetail course={course} lexeme={l} memory={mem} onDeleted={() => setDeleted(l)} />}
          </>
        )}
      />
      {deleted && (
        <div className="toast" role="status">
          Deleted “{deleted.lemma}”.
          <button
            className="ghost"
            onClick={() => {
              void write<Lexeme>("lexemes", { id: deleted.id, deleted: 0 });
              setDeleted(null);
            }}
          >
            Undo
          </button>
        </div>
      )}
    </div>
  );
}

const SKILL_NAME: Record<string, string> = { read: "Reading", listen: "Listening", write: "Writing" };

/** Who wrote a sentence, in plain words. */
function authorLabel(e: Example): { text: string; warn?: boolean } {
  if (e.source === "mined") return { text: "From your text" };
  if (e.source === "manual") return { text: "Added by you" };
  if (e.source === "import") return { text: "From your Anki deck" };
  if (e.origin === "hosted") return { text: "Written by Perennial AI" };
  if (e.origin === "own" || e.origin === "local") return { text: `Written by ${e.model}` };
  return { text: "Written by AI" };
}

/** "Write new sentences" with the current AI, with the cost shown first and an undo after. */
function RewriteButton({ course, lexemeIds, label }: { course: Course; lexemeIds: string[]; label: string }) {
  const [author, setAuthor] = useState<Author | null | undefined>(undefined);
  const { me } = useAccount();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Rewrite | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    void currentAuthor().then(setAuthor);
  }, []);
  if (author === undefined) return null;
  if (!author) return <span className="muted small">Connect an AI model in Settings to write new sentences.</span>;
  const hosted = author.origin === "hosted";
  const left = hosted && me ? me.credits.left : Infinity;
  const n = lexemeIds.length;
  const run = async () => {
    setBusy(true);
    setError("");
    try {
      setDone(await rewriteExamples(course, lexemeIds));
    } catch (e) {
      setError(hostedMessage(e));
    } finally {
      setBusy(false);
      if (hosted) void refreshMe().catch(() => {});
    }
  };
  if (done)
    return (
      <span className="small">
        {done.added.length ? `Wrote ${plural(done.added.length, "new sentence")}.` : "No new sentences this time."}{" "}
        <button className="ghost" onClick={() => void undoRewrite(done).then(() => setDone(null))}>
          Undo
        </button>
      </span>
    );
  return (
    <span className="row">
      <button className="secondary" disabled={busy || n > left} onClick={() => void run()}>
        {busy ? "Writing…" : label}
      </button>
      <span className="muted small">
        {hosted ? `With Perennial AI · uses ${plural(n, "AI word")}${n > left ? ` (you have ${left})` : ""}` : `With ${author.model}`}. Your own sentences stay.
      </span>
      {error && <span className="error">{error}</span>}
    </span>
  );
}

function WordDetail({ course, lexeme, memory, onDeleted }: { course: Course; lexeme: Lexeme; memory: MemoryRow[]; onDeleted: () => void }) {
  const examples = useLiveQuery(() => db.examples.where("lexemeId").equals(lexeme.id).toArray(), [lexeme.id]);
  const [gloss, setGloss] = useState(lexeme.gloss);
  const [notes, setNotes] = useState(lexeme.notes ?? "");
  const [showNotes, setShowNotes] = useState(!!lexeme.notes);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    if (gloss === lexeme.gloss && (notes || undefined) === lexeme.notes) return;
    await write<Lexeme>("lexemes", { id: lexeme.id, gloss, notes: notes || undefined });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="detail">
      <div className="form">
        {saved && <span className="ok small">Saved ✓</span>}
        <label>
          Meaning
          <input value={gloss} onChange={(e) => setGloss(e.target.value)} onBlur={() => void save()} />
        </label>
        {showNotes ? (
          <label>
            Note
            <input value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => void save()} autoFocus={!lexeme.notes} />
          </label>
        ) : (
          <button className="ghost link" onClick={() => setShowNotes(true)}>
            + Add a note
          </button>
        )}
      </div>
      {memory.some((m) => m.reps > 0) ? (
        <ul className="schedule">
          {memory
            .filter((m) => m.reps > 0)
            .sort((x, y) => SKILL_ORDER.indexOf(x.skill) - SKILL_ORDER.indexOf(y.skill))
            .map((m) => (
              <li key={m.skill}>
                <strong>{SKILL_NAME[m.skill]}:</strong> next review {m.due <= Date.now() ? "now" : relTime(m.due)} · {plural(m.reps, "review")}
                {m.lapses > 0 && ` · missed ${plural(m.lapses, "time")}`}
              </li>
            ))}
        </ul>
      ) : (
        <p className="muted small">Not started. It will come in a session as a new word.</p>
      )}
      <ul className="examples">
        {examples
          ?.filter((e) => !e.deleted)
          .map((e) => {
            const by = authorLabel(e);
            return (
              <li key={e.id}>
                <span>{e.text}</span> <span className="muted">— {e.translation}</span>
                <span className={by.warn ? "author warn" : "author"}>{by.text}</span>
                <button className="ghost small" onClick={() => void write<Example>("examples", { id: e.id, deleted: Date.now() })} aria-label="Remove sentence">
                  remove
                </button>
              </li>
            );
          })}
      </ul>
      <RewriteButton course={course} lexemeIds={[lexeme.id]} label="Write new sentences" />
      <div className="row">
        <button
          className="secondary"
          title="Paused words do not appear in sessions until you resume them"
          onClick={() => void write<Lexeme>("lexemes", { id: lexeme.id, status: lexeme.status === "suspended" ? "active" : "suspended" })}
        >
          {lexeme.status === "suspended" ? "Resume" : "Pause"}
        </button>
        <button
          className="ghost"
          onClick={() => {
            void write<Lexeme>("lexemes", { id: lexeme.id, deleted: Date.now() });
            onDeleted();
          }}
        >
          Delete
        </button>
        {lexeme.status === "suspended" && <span className="muted small">Paused. It does not appear in sessions.</span>}
      </div>
    </div>
  );
}
