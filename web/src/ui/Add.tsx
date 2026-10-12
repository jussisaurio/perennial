// Adding words from a text the learner wants to read. Tapped words that the
// course already has are simply moved to the front of the queue (free);
// words the course doesn't have are made by Perennial AI (one AI word each),
// keeping the learner's own sentence.

import { useMemo, useState } from "react";
import { apiMessage, mineWords, resetDate } from "../data/ai";
import { useFeatures } from "../data/server";
import { useUser } from "../data/auth";
import { readMemory, wordState } from "../core/memory";
import { setWordStatus, useLearner, useStore, type Learner } from "../data/learner";
import type { UserSentenceRow, UserWordRow, WordStateRow } from "../data/rows";
import { language } from "../content/languages";
import { formKey, tokenize } from "../content/text";
import { tooFewCredits, useMe } from "./Account";
import { track } from "../observability";

// "queued": in the course but not started yet. "added": picked by the learner.
type Status = "known" | "learning" | "queued" | "added" | "unknown" | "ignored";

function sentences(text: string, tag: string): { text: string; start: number }[] {
  const seg = new Intl.Segmenter(tag, { granularity: "sentence" });
  return [...seg.segment(text)].map((s) => ({ text: s.segment.trim(), start: s.index }));
}

const formStateId = (lang: string, form: string) => `form:${lang}:${form}`;

function statusMap(l: Learner): Map<string, { status: Status; wordId?: string }> {
  const map = new Map<string, { status: Status; wordId?: string }>();
  for (const w of l.words.values()) {
    const st = wordState(readMemory(l, w.id));
    const status: Status = w.status === "ignored" ? "ignored" : st !== "new" ? st : w.status === "queued" || w.source === "user" ? "added" : "queued";
    for (const f of w.forms) {
      const cur = map.get(f);
      // A form shared by two words shows the more advanced one.
      if (!cur || cur.status === "queued") map.set(f, { status, wordId: w.id });
    }
  }
  for (const [id, s] of l.states) if (id.startsWith(`form:${l.lang}:`) && s.status === "ignored") map.set(id.split(":").slice(2).join(":"), { status: "ignored" });
  return map;
}

function MineText({ learner }: { learner: Learner }) {
  const store = useStore();
  const { user } = useUser();
  const { me, refresh } = useMe();
  const { ai } = useFeatures();
  const tag = language(learner.lang).tag;
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Map<string, string>>(new Map()); // form -> sentence
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const statusOf = useMemo(() => statusMap(learner), [learner]);

  const sents = useMemo(() => sentences(text, tag), [text, tag]);
  const tokens = useMemo(() => tokenize(text, tag), [text, tag]);
  const sentenceAt = (i: number) => [...sents].reverse().find((s) => s.start <= i)?.text ?? "";
  const isNew = (s: Status | undefined) => s === undefined || s === "unknown" || s === "queued";
  const unknownCount = new Set(tokens.filter((t) => t.word && isNew(statusOf.get(formKey(t.text))?.status) && !/^\d+$/.test(t.text)).map((t) => formKey(t.text))).size;

  // Words the course has are free; the rest need Perennial AI.
  const inCourse = [...picked.keys()].filter((f) => statusOf.get(f)?.wordId);
  const needAI = [...picked.keys()].filter((f) => !statusOf.get(f)?.wordId);
  const canAI = ai && !!user && !user.anonymous;
  // Without Perennial AI on this server, only course words can be added.
  const tooMany = ai && needAI.length > 0 && (!canAI || tooFewCredits(me, needAI.length));
  const adding = ai ? picked.size : inCourse.length;

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
    // Saved so far: AI words go in batches, and a later batch can fail after earlier ones were saved.
    const done: string[] = [];
    try {
      for (const f of inCourse) {
        await setWordStatus(store, statusOf.get(f)!.wordId!, "queued");
        done.push(f);
      }
      const items = ai ? needAI.map((form) => ({ form, sentence: picked.get(form)! })) : [];
      const known = learner.studied.slice(0, 400).map((w) => w.lemma);
      for (let i = 0; i < items.length; i += 15) {
        const batch = items.slice(i, i + 15);
        const r = await mineWords(learner.lang, batch, known);
        const now = new Date().toISOString();
        await store.write(() => {
          for (const w of r.words) {
            const id = crypto.randomUUID();
            store.collections.user_word.insert({ id, user_id: store.userId, lang: learner.lang, lemma: w.lemma, gloss: w.gloss, pos: w.pos || null, forms: w.forms, notes: w.notes ?? null, deck_id: null, created_at: now } as UserWordRow & Record<string, unknown>);
            w.examples.forEach((e, k) => {
              if (!e.text.includes(e.cloze) || e.cloze.length >= e.text.length) return;
              store.collections.user_sentence.insert({ id: crypto.randomUUID(), user_id: store.userId, word_id: id, text: e.text, translation: e.translation, cloze: e.cloze, origin: k === 0 ? "own-text" : "ai", model: r.model, created_at: now } as UserSentenceRow & Record<string, unknown>);
            });
          }
        });
        done.push(...batch.map((b) => b.form));
      }
      track("words_added", { fromCourse: inCourse.length, withAI: items.length });
      setPicked(new Map());
      setResult(`Added ${adding} ${adding === 1 ? "word" : "words"} (marked ✓). You will see them first in your next session.`);
    } catch (e) {
      if (!done.length) setResult(`Could not add the words: ${apiMessage(e)}`);
      else {
        // Some were saved: unselect them and say so, so trying again sends only the rest.
        const fromCourse = done.filter((f) => inCourse.includes(f)).length;
        track("words_added", { fromCourse, withAI: done.length - fromCourse, partial: true });
        setPicked((p) => new Map([...p].filter(([form]) => !done.includes(form))));
        setResult(`Added ${done.length} ${done.length === 1 ? "word" : "words"} (marked ✓). The rest could not be added: ${apiMessage(e)}`);
      }
    } finally {
      setBusy(false);
      refresh();
    }
  };

  // Words you never want to study (names, onomatopoeia) stop being highlighted.
  const ignore = async () => {
    const now = new Date().toISOString();
    await store.write(() => {
      for (const form of picked.keys()) {
        const id = statusOf.get(form)?.wordId ?? formStateId(learner.lang, form);
        const c = store.collections.word_state;
        if (c.has(id))
          c.update(id, (d) => {
            d.status = "ignored";
            d.updated_at = now;
          });
        else c.insert({ user_id: store.userId, word_id: id, status: "ignored", queued_at: null, updated_at: now } as WordStateRow & Record<string, unknown>);
      }
    });
    setResult(`${picked.size === 1 ? "This word is" : "These words are"} no longer marked as new.`);
    setPicked(new Map());
  };

  return (
    <section>
      <h2>From a text</h2>
      <p className="muted small">Paste a text that you want to read, for example a message or song lyrics. Then tap the words that you want to learn.</p>
      {canAI && me && (
        <p className="muted small">
          Words from the course are free. Other words use Perennial AI: you have <strong>{me.credits.left}</strong> of {me.credits.limit} AI words left this month.
        </p>
      )}
      <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={`Paste ${language(learner.lang).name} text here`} lang={tag} />
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
              const st = statusOf.get(form)?.status ?? "unknown";
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
            <button className="primary" disabled={!adding || busy || tooMany} onClick={() => void add()}>
              {busy
                ? "Adding…"
                : adding
                  ? `Learn ${adding} ${adding === 1 ? "word" : "words"}${ai && needAI.length ? ` · uses ${needAI.length} AI ${needAI.length === 1 ? "word" : "words"}` : ""}`
                  : "Select words to learn"}
            </button>
            <button className="ghost" disabled={!picked.size} onClick={() => void ignore()} title="Names and other words you never want to learn">
              Never mark as new
            </button>
          </div>
          {result && <p className="small">{result}</p>}
          {/* `me` is known here: tooFewCredits blocks only on a known count. */}
          {tooMany && canAI && me && (
            <div className="credit-note">
              <p className="small">
                You selected {needAI.length} {needAI.length === 1 ? "word that is" : "words that are"} not in the course, but you have{" "}
                {me.credits.left === 0 ? "no AI words" : `only ${me.credits.left} AI ${me.credits.left === 1 ? "word" : "words"}`} left this month.{" "}
                {me.credits.left > 0 ? `Select ${needAI.length - me.credits.left} fewer, or wait until ${resetDate()}.` : `Wait until ${resetDate()}.`}
              </p>
            </div>
          )}
          {!ai && needAI.length > 0 && (
            <p className="muted small">
              {needAI.length === 1 ? "1 selected word is" : `${needAI.length} selected words are`} not in the course yet, so {needAI.length === 1 ? "it" : "they"} cannot be added. You can mark {needAI.length === 1 ? "it" : "them"} “never new”.
            </p>
          )}
          {tooMany && !canAI && <p className="muted small">Some of these words are not in the course. To have Perennial AI make cards for them, add your email in Settings.</p>}
        </>
      )}
    </section>
  );
}

export function AddScreen({ lang, onBack }: { lang: string; onBack: () => void }) {
  const learner = useLearner(lang);
  return (
    <div className="page">
      <button className="ghost link" onClick={onBack}>
        ← Words
      </button>
      <h1>Add words</h1>
      {learner && <MineText learner={learner} />}
    </div>
  );
}
