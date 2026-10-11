// Course content: frequency lists -> LLM-written entries with graded example
// sentences. Runs in the background to keep a small pool of words ready.

import { generateCourseBatch, mineWords, moreExamples, type Author } from "../ai/backend";
import type { GenLexeme } from "../ai/prompts";
import { db, stableId, uid, writeMany } from "../db/db";
import type { Course, Example, Lexeme } from "../model";
import { language } from "./languages";
import { findForm, formKey, parseFrequencyList, type FreqEntry } from "./text";

const FREQ_URL = "https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018";
const LIST_SIZE = 50_000;

const loading = new Map<string, Promise<FreqEntry[]>>();

export function frequencyList(lang: string): Promise<FreqEntry[]> {
  let p = loading.get(lang);
  if (!p) {
    p = loadFrequencyList(lang).finally(() => loading.delete(lang));
    loading.set(lang, p);
  }
  return p;
}

async function loadFrequencyList(lang: string): Promise<FreqEntry[]> {
  const cached = await db.freq.get(lang);
  if (cached) return cached.entries;
  let res = await fetch(`${FREQ_URL}/${lang}/${lang}_50k.txt`);
  if (res.status === 404) res = await fetch(`${FREQ_URL}/${lang}/${lang}_full.txt`);
  if (!res.ok || !res.body) throw new Error(`Couldn't download the ${lang} frequency list (${res.status})`);
  // Full lists can be large; read only as far as we need.
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  let lines = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += value;
    lines += value.split("\n").length - 1;
    if (lines > LIST_SIZE) {
      void reader.cancel();
      break;
    }
  }
  const entries = parseFrequencyList(text, LIST_SIZE);
  await db.freq.put({ lang, entries });
  return entries;
}

/** Lemmas the learner has started on, most frequent first; fed to the LLM as "known vocabulary". */
export async function knownLemmas(courseId: string, limit = 400): Promise<string[]> {
  const learned = new Set((await db.memory.where("courseId").equals(courseId).toArray()).filter((m) => m.reps > 0).map((m) => m.lexemeId));
  const lex = (await db.lexemes.where("courseId").equals(courseId).toArray()).filter((l) => learned.has(l.id));
  return lex
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))
    .slice(0, limit)
    .map((l) => l.lemma);
}

/** Persist generated entries, merging into existing lexemes with the same lemma. */
async function saveGenerated(
  course: Course,
  gen: GenLexeme[],
  extra: (g: GenLexeme) => Partial<Lexeme>,
  source: Example["source"],
  rankOf?: Map<string, number>,
  by?: Author,
): Promise<Lexeme[]> {
  const tag = language(course.lang).tag;
  const lexRows: Lexeme[] = [];
  const exRows: Example[] = [];
  const now = Date.now();
  for (const g of gen) {
    if (!g.lemma || !g.gloss) continue;
    const id = await stableId(course.id, formKey(g.lemma));
    const prev = await db.lexemes.get(id);
    const forms = [...new Set([...(prev?.forms ?? []), ...g.forms.map(formKey), formKey(g.lemma)])].filter(Boolean);
    const ranks = forms.map((f) => rankOf?.get(f)).filter((r): r is number => r !== undefined);
    const rank = ranks.length ? Math.min(...ranks, prev?.rank ?? Infinity) : prev?.rank;
    const row: Lexeme = {
      id,
      courseId: course.id,
      lemma: prev?.lemma ?? g.lemma,
      gloss: prev?.gloss ?? g.gloss,
      pos: prev?.pos ?? g.pos,
      notes: prev?.notes ?? g.notes,
      forms,
      rank,
      addedAt: prev?.addedAt ?? now,
      // Adding a word you previously deleted or ignored brings it back.
      status: prev?.status === "ignored" ? "active" : (prev?.status ?? "active"),
      deleted: 0,
      ...extra(g),
    };
    lexRows.push(row);
    for (const e of g.examples) {
      // Some models mark the whole sentence as the target word; find the word instead.
      const plausible = e.cloze && e.text.includes(e.cloze) && [...e.cloze].length <= Math.max(12, [...g.lemma].length * 2 + 4);
      const cloze = plausible ? e.cloze : findForm(e.text, forms, tag);
      if (!cloze) continue; // a sentence that doesn't contain the word is useless
      // The learner's own sentences (the one from their text, typed, imported)
      // keep their source. Everything else was written by the AI and says by whom.
      const own = source === "mined" ? e === g.examples[0] : source !== "llm";
      exRows.push({
        id: uid(),
        courseId: course.id,
        lexemeId: id,
        text: e.text,
        translation: e.translation,
        cloze,
        source: own ? source : "llm",
        createdAt: now,
        ...(!own && by ? { origin: by.origin, model: by.model } : {}),
      });
    }
  }
  await writeMany("lexemes", lexRows);
  await writeMany("examples", exRows);
  return lexRows;
}

const BATCH_FORMS = 24;

/** Generate the next batch of words from the frequency list. */
export async function buildNextBatch(course: Course): Promise<number> {
  const freq = await frequencyList(course.lang);
  const rankOf = new Map(freq.map((f, i) => [f.form, i + 1]));
  const existing = await db.lexemes.where("courseId").equals(course.id).toArray();
  const covered = new Set(existing.flatMap((l) => l.forms));
  let cursor = course.freqCursor ?? 0;
  const forms: string[] = [];
  while (forms.length < BATCH_FORMS && cursor < freq.length) {
    const f = freq[cursor++].form;
    if (!covered.has(f)) forms.push(f);
  }
  if (!forms.length) return 0;
  const known = await knownLemmas(course.id);
  const { words, next, by } = await generateCourseBatch(course, { forms, cursor: course.freqCursor ?? 0, next: cursor }, { known, existing: existing.map((l) => l.lemma) });
  const saved = await saveGenerated(course, words, () => ({}), "llm", rankOf, by);
  await writeMany<Course>("courses", [{ id: course.id, freqCursor: next }]);
  return saved.length;
}

/** Lexemes not yet introduced, in the order they should be taught. */
export async function freshLexemes(courseId: string): Promise<Lexeme[]> {
  const started = new Set(await db.memory.where("courseId").equals(courseId).toArray().then((m) => m.map((r) => r.lexemeId)));
  const lex = await db.lexemes.where("courseId").equals(courseId).toArray();
  const exCount = new Map<string, number>();
  for (const e of await db.examples.where("courseId").equals(courseId).toArray()) if (!e.deleted) exCount.set(e.lexemeId, (exCount.get(e.lexemeId) ?? 0) + 1);
  return lex
    .filter((l) => !started.has(l.id) && !l.deleted && (l.status ?? "active") === "active")
    // Imported cards may have no sentences; everything else needs at least one.
    .filter((l) => exCount.get(l.id) || l.rank === undefined)
    // Words the learner picked come first (oldest pick first), then by frequency.
    .sort((a, b) => (a.picked ?? Infinity) - (b.picked ?? Infinity) || (a.rank ?? 1e9) - (b.rank ?? 1e9));
}

const POOL = 20;
let filling: Promise<void> | null = null;

/** Keep ~20 words ready so sessions never wait on the network. */
export function ensurePool(course: Course, onProgress?: (n: number) => void): Promise<void> {
  filling ??= (async () => {
    try {
      for (let i = 0; i < 5; i++) {
        const c = (await db.courses.get(course.id)) ?? course;
        const have = (await freshLexemes(c.id)).length;
        onProgress?.(have);
        if (have >= POOL) break;
        if ((await buildNextBatch(c)) === 0) break;
      }
    } finally {
      filling = null;
    }
  })();
  return filling;
}

/** Ask the current AI for fresh sentences for these words and store them. */
async function writeFreshExamples(course: Course, lexemes: Lexeme[], existing: Map<string, Example[]>): Promise<Example[]> {
  const words = lexemes.map((l) => ({ lemma: l.lemma, gloss: l.gloss || l.lemma, seen: (existing.get(l.id) ?? []).map((e) => e.text).slice(-6) }));
  const { examples: gen, by } = await moreExamples(course, words, await knownLemmas(course.id));
  const tag = language(course.lang).tag;
  const rows: Example[] = [];
  for (const g of gen) {
    const lex = lexemes.find((l) => formKey(l.lemma) === formKey(g.lemma));
    if (!lex) continue;
    const cloze = g.cloze && g.text.includes(g.cloze) && [...g.cloze].length <= Math.max(12, [...lex.lemma].length * 2 + 4) ? g.cloze : findForm(g.text, lex.forms, tag);
    if (cloze) rows.push({ id: uid(), courseId: course.id, lexemeId: lex.id, text: g.text, translation: g.translation, cloze, source: "llm", createdAt: Date.now(), origin: by.origin, model: by.model });
  }
  await writeMany("examples", rows);
  return rows;
}

async function examplesByLexeme(courseId: string): Promise<Map<string, Example[]>> {
  const byLex = new Map<string, Example[]>();
  for (const e of await db.examples.where("courseId").equals(courseId).toArray()) {
    if (e.deleted) continue;
    const list = byLex.get(e.lexemeId);
    if (list) list.push(e);
    else byLex.set(e.lexemeId, [e]);
  }
  return byLex;
}

/** Give well-practised words new sentences, written with the learner's now-larger vocabulary. */
export async function refreshExamples(course: Course, max = 8): Promise<number> {
  const reviews = await db.reviews.where("courseId").equals(course.id).filter((r) => !r.deleted).toArray();
  const shown = new Map<string, number>();
  for (const r of reviews) if (r.exampleId) shown.set(r.exampleId, (shown.get(r.exampleId) ?? 0) + 1);
  const byLex = await examplesByLexeme(course.id);
  const stale = [...byLex.entries()].filter(([, exs]) => exs.every((e) => (shown.get(e.id) ?? 0) >= 2)).slice(0, max);
  if (!stale.length) return 0;
  const lexemes = (await db.lexemes.bulkGet(stale.map(([id]) => id))).filter((l): l is Lexeme => !!l);
  return (await writeFreshExamples(course, lexemes, byLex)).length;
}

/** What a replacement did, so it can be undone. */
export interface Rewrite {
  added: string[];
  removed: string[];
}

/**
 * Replace AI-written sentences with new ones from the current AI. The
 * learner's own sentences (typed, from their texts) are never touched, and old
 * sentences are only removed for words that got new ones.
 */
export async function rewriteExamples(course: Course, lexemeIds: string[], replace: (e: Example) => boolean = () => true): Promise<Rewrite> {
  const byLex = await examplesByLexeme(course.id);
  const result: Rewrite = { added: [], removed: [] };
  for (let i = 0; i < lexemeIds.length; i += 8) {
    const lexemes = (await db.lexemes.bulkGet(lexemeIds.slice(i, i + 8))).filter((l): l is Lexeme => !!l && !l.deleted);
    const fresh = await writeFreshExamples(course, lexemes, byLex);
    const got = new Set(fresh.map((e) => e.lexemeId));
    const old = lexemes.flatMap((l) => (got.has(l.id) ? (byLex.get(l.id) ?? []).filter((e) => e.source === "llm" && replace(e)) : []));
    await writeMany<Example>("examples", old.map((e) => ({ id: e.id, deleted: Date.now() })));
    result.added.push(...fresh.map((e) => e.id));
    result.removed.push(...old.map((e) => e.id));
  }
  return result;
}

export async function undoRewrite(r: Rewrite): Promise<void> {
  await writeMany<Example>("examples", [...r.added.map((id) => ({ id, deleted: Date.now() })), ...r.removed.map((id) => ({ id, deleted: 0 }))]);
}

/** Words whose AI sentences were written by a model on the learner's computer. */
export async function wordsWithLocalSentences(courseId: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const e of await db.examples.where("courseId").equals(courseId).toArray()) if (!e.deleted && e.origin === "local") ids.add(e.lexemeId);
  return [...ids];
}

/** Words picked from pasted text: their original sentence becomes the first example. */
export async function addMined(course: Course, items: { form: string; sentence: string }[]): Promise<Lexeme[]> {
  const freq = await db.freq.get(course.lang);
  const rankOf = new Map((freq?.entries ?? []).map((f, i) => [f.form, i + 1]));
  const { words, by } = await mineWords(course, items, await knownLemmas(course.id));
  const now = Date.now();
  return saveGenerated(course, words, () => ({ picked: now }), "mined", rankOf, by);
}

/** Manual entry when no AI provider is configured. */
export async function addManual(course: Course, w: { lemma: string; gloss: string; sentence?: string; translation?: string }): Promise<void> {
  const gen: GenLexeme = {
    lemma: w.lemma,
    gloss: w.gloss,
    pos: "",
    forms: [w.lemma],
    examples: w.sentence ? [{ text: w.sentence, translation: w.translation ?? "", cloze: "" }] : [],
  };
  await saveGenerated(course, [gen], () => ({ picked: Date.now() }), "manual");
}
