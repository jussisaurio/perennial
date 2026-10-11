import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import { aiMode, type AIMode } from "../ai/backend";
import { hostedMessage, refreshMe, resetDate } from "../hosted/api";
import { UpgradeOffer, useAccount } from "./Account";
import { addManual, addMined } from "../content/builder";
import { language } from "../content/languages";
import { formKey, tokenize } from "../content/text";
import { db, stableId, writeMany } from "../db/db";
import type { Course, Lexeme } from "../model";
import { wordState } from "./stats";

// "queued": in the course but never practised, so still new to the learner.
// "added": queued because the learner picked it from a text.
type Status = "known" | "learning" | "queued" | "added" | "unknown" | "ignored";

function sentences(text: string, tag: string): { text: string; start: number }[] {
  const seg = new Intl.Segmenter(tag, { granularity: "sentence" });
  return [...seg.segment(text)].map((s) => ({ text: s.segment.trim(), start: s.index }));
}

function MineText({ course, mode }: { course: Course; mode: AIMode | null }) {
  const tag = language(course.lang).tag;
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Map<string, string>>(new Map()); // form -> sentence
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const { me } = useAccount();
  const lexemes = useLiveQuery(() => db.lexemes.where("courseId").equals(course.id).toArray(), [course.id]);
  const memory = useLiveQuery(() => db.memory.where("courseId").equals(course.id).toArray(), [course.id]);

  const statusOf = useMemo(() => {
    const read = new Map((memory ?? []).filter((m) => m.skill === "read").map((m) => [m.lexemeId, m]));
    const map = new Map<string, Status>();
    for (const l of lexemes ?? []) {
      if (l.deleted) continue;
      const st = wordState(read.get(l.id));
      const s: Status = l.status === "ignored" ? "ignored" : st === "new" ? (l.picked ? "added" : "queued") : st;
      for (const f of l.forms) map.set(f, s);
    }
    return map;
  }, [lexemes, memory]);

  const sents = useMemo(() => sentences(text, tag), [text, tag]);
  const tokens = useMemo(() => tokenize(text, tag), [text, tag]);
  const sentenceAt = (i: number) => [...sents].reverse().find((s) => s.start <= i)?.text ?? "";
  const isNew = (s: Status | undefined) => s === undefined || s === "unknown" || s === "queued";
  const unknownCount = new Set(tokens.filter((t) => t.word && isNew(statusOf.get(formKey(t.text))) && !/^\d+$/.test(t.text)).map((t) => formKey(t.text))).size;

  // Hosted AI words are limited; show the cost before the tap, never after.
  const hosted = mode === "hosted";
  const left = hosted && me ? me.credits.left : Infinity;
  const tooMany = picked.size > left;

  const toggle = (form: string, index: number) => {
    const next = new Map(picked);
    if (next.has(form)) next.delete(form);
    else next.set(form, sentenceAt(index));
    setPicked(next);
    setResult(null);
  };

  const add = async () => {
    if (tooMany) return;
    setBusy(true);
    setResult(null);
    try {
      const items = [...picked].map(([form, sentence]) => ({ form, sentence }));
      for (let i = 0; i < items.length; i += 15) await addMined(course, items.slice(i, i + 15));
      setPicked(new Map());
      setResult(`Added ${items.length} ${items.length === 1 ? "word" : "words"} (marked ✓). You will see them first in your next session.`);
    } catch (e) {
      setResult(`Could not add the words: ${hostedMessage(e)}`);
    } finally {
      setBusy(false);
      void refreshMe().catch(() => {});
    }
  };

  // Words you never want to study (names, onomatopoeia) stop being highlighted.
  const ignore = async () => {
    const rows: Lexeme[] = [];
    for (const form of picked.keys())
      if (!statusOf.has(form))
        rows.push({ id: await stableId(course.id, form), courseId: course.id, lemma: form, gloss: "", forms: [form], addedAt: Date.now(), status: "ignored" });
    await writeMany("lexemes", rows);
    setResult(`${rows.length === 1 ? "This word is" : "These words are"} no longer marked as new.`);
    setPicked(new Map());
  };

  return (
    <section>
      <h2>From a text</h2>
      <p className="muted small">Paste a text that you want to read, for example a message or song lyrics. Then tap the words that you want to learn.</p>
      {hosted && me && (
        <p className="muted small">
          You have <strong>{me.credits.left}</strong> of {me.credits.limit} AI words left this month. Each word you learn from a text uses one.
        </p>
      )}
      <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Paste ${language(course.lang).name} text here`} lang={tag} />
      {text && (
        <>
          <p className="muted small legend-row">
            {unknownCount === 1 ? "1 new word" : `${unknownCount} new words`}. <span className="legend new-word">new</span>
            <span className="legend learning">learning</span>
            <span className="legend picked">✓ selected</span>
            <span className="legend added">✓ added</span>
          </p>
          <div className="reader" lang={tag}>
            {tokens.map((t, i) => {
              if (!t.word) return <span key={i}>{t.text}</span>;
              const form = formKey(t.text);
              const st = statusOf.get(form) ?? "unknown";
              const sel = picked.has(form);
              const cls = sel ? "picked" : st === "added" ? "added" : isNew(st) ? "new-word" : st === "learning" ? "learning" : "";
              return (
                <button key={i} type="button" className={`tok ${cls}`} aria-pressed={sel} onClick={() => toggle(form, t.index)}>
                  {t.text}
                </button>
              );
            })}
          </div>
          <div className="row">
            <button className="primary" disabled={!picked.size || !mode || busy || tooMany} onClick={() => void add()}>
              {busy ? "Adding…" : picked.size ? `Learn ${picked.size} ${picked.size === 1 ? "word" : "words"}${hosted ? ` · uses ${picked.size} AI ${picked.size === 1 ? "word" : "words"}` : ""}` : "Select words to learn"}
            </button>
            <button className="ghost" disabled={!picked.size} onClick={() => void ignore()} title="Names and other words you never want to learn">
              Never mark as new
            </button>
          </div>
          {result && <p className="small">{result}</p>}
          {tooMany && (
            <div className="credit-note">
              <p className="small">
                You selected {picked.size} words, but you have only {left} AI {left === 1 ? "word" : "words"} left this month.{" "}
                {left > 0 ? `Select ${picked.size - left} fewer, ` : ""}
                wait until {resetDate()}, type words yourself below (free), or use your own API key in Settings.
              </p>
              {me && <UpgradeOffer me={me} />}
            </div>
          )}
          {!mode && <p className="muted small">To add words from a text, sign in or connect an AI model in Settings.</p>}
        </>
      )}
    </section>
  );
}

function ManualAdd({ course }: { course: Course }) {
  const [w, setW] = useState({ lemma: "", gloss: "", sentence: "", translation: "" });
  const [msg, setMsg] = useState("");
  return (
    <section>
      <h2>Type a word</h2>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!w.lemma || !w.gloss) return;
          await addManual(course, w);
          setMsg(`Added “${w.lemma}”.`);
          setW({ lemma: "", gloss: "", sentence: "", translation: "" });
        }}
      >
        <div className="row">
          <input placeholder="word" value={w.lemma} onChange={(e) => setW({ ...w, lemma: e.target.value })} />
          <input placeholder="meaning" value={w.gloss} onChange={(e) => setW({ ...w, gloss: e.target.value })} />
        </div>
        <details className="more">
          <summary>Add an example sentence</summary>
          <div className="form">
            <input placeholder="example sentence" value={w.sentence} onChange={(e) => setW({ ...w, sentence: e.target.value })} />
            <input placeholder="translation of the sentence" value={w.translation} onChange={(e) => setW({ ...w, translation: e.target.value })} />
          </div>
        </details>
        <div className="row">
          <button className="primary" type="submit" disabled={!w.lemma || !w.gloss}>
            Add
          </button>
          <span className="muted small">{msg}</span>
        </div>
      </form>
    </section>
  );
}

function ImportApkg({ course }: { course: Course }) {
  const [state, setState] = useState<string>("");
  const [preview, setPreview] = useState<{ front: string; back: string; tags: string }[] | null>(null);
  const [existing, setExisting] = useState(0);
  return (
    <details className="more">
      <summary>Import an Anki deck</summary>
      <p className="muted small">The first field of each card becomes the word, and the second field becomes the meaning. Your Anki review history is not imported. Words that are already in your course are not changed.</p>
      <input
        type="file"
        accept=".apkg,.colpkg"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setState("Reading…");
          try {
            const { readApkg, existingNotes } = await import("../content/apkg");
            const { notes } = await readApkg(file);
            setPreview(notes);
            const dup = (await existingNotes(course, notes)).size;
            setExisting(dup);
            setState(`Found ${notes.length} cards.${dup ? ` ${dup} of them are already in your course and will be skipped.` : ""}`);
          } catch (err) {
            setState(`Could not read this file: ${err instanceof Error ? err.message : err}`);
          }
        }}
      />
      {preview && (
        <>
          <ul className="examples">
            {preview.slice(0, 5).map((n, i) => (
              <li key={i}>
                <strong>{n.front}</strong> <span className="muted">— {n.back}</span>
              </li>
            ))}
          </ul>
          <button
            className="primary"
            disabled={preview.length === existing}
            onClick={async () => {
              const { importNotes } = await import("../content/apkg");
              const r = await importNotes(course, preview);
              setPreview(null);
              setState(`Imported ${r.added} words.${r.skipped ? ` Skipped ${r.skipped} that were already in your course.` : ""}`);
            }}
          >
            Import {preview.length - existing} new {preview.length - existing === 1 ? "word" : "words"}
          </button>
        </>
      )}
      <span className="muted small"> {state}</span>
    </details>
  );
}

export function AddScreen({ course, onBack }: { course: Course; onBack: () => void }) {
  const [mode, setMode] = useState<AIMode | null>(null);
  useEffect(() => {
    void aiMode().then(setMode);
  }, []);
  return (
    <div className="page">
      <button className="ghost link" onClick={onBack}>
        ← Words
      </button>
      <h1>Add words</h1>
      <MineText course={course} mode={mode} />
      <ManualAdd course={course} />
      <ImportApkg course={course} />
    </div>
  );
}
