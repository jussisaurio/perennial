// Drafts new source words with Claude and appends them to decks/<lang>/source/.
// A human reviews the diff, then runs build.ts. Never run in CI (it costs money).
//
//   bun scripts/deck/generate.ts es --count 200 [--from 41] [--group 10]
//   bun scripts/deck/generate.ts es --count 20 --mock    (needs `bun server/mock-llm.ts`)
//
// 1. Surface forms come from the OpenSubtitles frequency list (hermitdave/FrequencyWords).
//    Forms an existing word already lists are skipped; the model maps the rest to
//    lemmas in order of first appearance (a few small synchronous calls).
// 2. Entries are written through the Message Batches API (half price), one request
//    per group of lemmas, with structured outputs. Invalid or missing entries are
//    retried in a second and third batch; what still fails is reported and left out.
//
// Env: ANTHROPIC_API_KEY, DECK_MODEL (default claude-sonnet-4-5), ANTHROPIC_BASE_URL.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SourceWord, isDeckLang, manifestKey } from "../../web/src/deck/schema.ts";
import { language } from "../../web/src/content/languages.ts";
import { frequencyListUrl } from "./audit.ts";
import { MAX_SENTENCE_WORDS, WORDS_PER_FILE, deckDir, flagValue, readSource, sourceFiles, toJson, wholeWordCount, wordCount } from "./lib.ts";

if (process.env.CI) {
  console.error("generate.ts calls a paid API and must not run in CI.");
  process.exit(1);
}

// ---- Arguments ---------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string) => flagValue(args, name);
const lang = args[0];
const count = Number(flag("count"));
const group = Number(flag("group") ?? 10);
const mock = args.includes("--mock");
if (!isDeckLang(lang) || !(count > 0)) {
  console.error("usage: bun scripts/deck/generate.ts <es|de> --count <n> [--from <rank>] [--group <n>] [--mock]");
  process.exit(2);
}
const LANG_NAME = language(lang).name;
const GENDERS = { es: "m or f (mf for nouns used for both, like estudiante)", de: "m, f or n" }[lang];
const MODEL = mock ? "mock" : (process.env.DECK_MODEL ?? "claude-sonnet-4-5");

const existing = readSource(lang);
if (existing.errors.length) {
  for (const e of existing.errors) console.error(e);
  console.error("fix the source files first");
  process.exit(1);
}
const from = Number(flag("from") ?? existing.words.length + 1);
if (from !== existing.words.length + 1) {
  console.error(`the source has ${existing.words.length} words, so new words start at rank ${existing.words.length + 1} (generate only appends)`);
  process.exit(2);
}

const client = mock
  ? new Anthropic({ apiKey: "mock", baseURL: process.env.ANTHROPIC_BASE_URL ?? "http://localhost:8788" })
  : new Anthropic();

// ---- 1. Frequency list → new lemmas ------------------------------------------------

type Lemma = { lemma: string; pos: SourceWord["pos"]; sense?: string };
const POS = SourceWord.shape.pos;
const LemmaList = z.object({
  lemmas: z.array(z.object({ lemma: z.string(), pos: z.string(), sense: z.string().optional() })),
});

async function frequencyForms(): Promise<string[]> {
  const url = frequencyListUrl(lang);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.text())
    .split("\n")
    .map((line) => line.split(" ")[0]?.normalize("NFC"))
    .filter((f): f is string => !!f && /^\p{L}+$/u.test(f));
}

const LEMMA_SYSTEM = `You map ${LANG_NAME} surface forms from a film-subtitle frequency list to dictionary lemmas for a language course for English speakers.

Rules:
- Return one entry per distinct lemma, in order of the first form that maps to it.
- A lemma is the dictionary form: infinitive for verbs, masculine singular for ${lang === "es" ? "adjectives and articles" : "adjectives, der for articles"}, singular for nouns${lang === "de" ? " (capitalized)" : ""}.
- pos is one of: ${POS.options.join(", ")}.
- If a form belongs to two different lemmas, use the more common reading.
- Add "sense" (a few English words) only when one lemma and part of speech has two unrelated meanings that both deserve a card.
- Skip proper nouns (names, places, brands), profanity and slurs, interjections that are just sounds, English words, typos and fragments.`;

async function lemmatize(forms: string[]): Promise<Lemma[]> {
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: LEMMA_SYSTEM,
    messages: [{ role: "user", content: `Surface forms (most frequent first):\n${forms.join(", ")}\n` }],
    output_config: { format: format(LemmaList) },
  });
  const parsed = LemmaList.safeParse(JSON.parse(text(res)));
  if (!parsed.success) throw new Error(`lemmatize: bad output: ${parsed.error.message}`);
  return parsed.data.lemmas.flatMap((l) => {
    const pos = POS.safeParse(l.pos);
    return pos.success && l.lemma.trim() ? [{ lemma: l.lemma.trim().normalize("NFC"), pos: pos.data, ...(l.sense ? { sense: l.sense } : {}) }] : [];
  });
}

async function newLemmas(): Promise<Lemma[]> {
  const known = new Set(existing.words.flatMap((w) => [w.lemma, ...w.forms]).map((f) => f.toLowerCase()));
  const keys = new Set(existing.words.map(manifestKey));
  const candidates = (await frequencyForms()).filter((f) => !known.has(f.toLowerCase()));
  const out: Lemma[] = [];
  const window = Math.max(60, Math.ceil(count * 1.5));
  for (let at = 0; out.length < count && at < candidates.length; at += window) {
    const forms = candidates.slice(at, at + window);
    console.log(`lemmatizing forms ${at + 1}–${at + forms.length} of the unseen frequency list…`);
    for (const l of await lemmatize(forms)) {
      if (keys.has(manifestKey(l))) continue;
      keys.add(manifestKey(l));
      out.push(l);
    }
  }
  return out.slice(0, count);
}

// ---- 2. Lemmas → source words --------------------------------------------------------

const WordList = z.object({ words: z.array(SourceWord) });

function system(): string {
  const knownLemmas = existing.words.slice(0, 500).map((w) => w.lemma);
  return `You write entries for a ${LANG_NAME} vocabulary course for English speakers who are beginners. Each entry is one lemma with example sentences that the learner reviews with spaced repetition, as cloze cards.

For each requested lemma, write:
- lemma: exactly as requested.
- gloss: the meaning in plain, everyday English, as a learner would want it ("house"; "to want; to love"). Two or three senses at most, most common first, separated by "; ". No grammar jargon, no "(n.)".
- pos: exactly as requested.
- forms: the inflected forms a learner will actually meet, most common first (for verbs: the common present, past and participle forms; for nouns: singular and plural; for adjectives: the gender and number forms). Lemma included. At most 15.
- gender: for nouns only: ${GENDERS}. Leave it out for other parts of speech.
- notes: optional, one short sentence when something will trip a learner up (an irregular form, a false friend, a usage rule). Leave it out otherwise.
- sentences: 3 or 4.

Sentences:
- Natural ${LANG_NAME} that a native speaker would actually say, in everyday situations. Correct spelling, accents${lang === "de" ? ", umlauts, ß and noun capitalization" : " and punctuation (¿ ¡)"}.
- Short: at most 10 words, never more than 12.
- Built from very common words: mostly words more frequent than the target. The course so far covers: ${knownLemmas.join(", ") || "(nothing yet)"}.
- Each sentence uses the target lemma exactly once, and each shows it in a different form or use. For verbs, nouns and adjectives, cover the most frequent forms (for verbs: different persons and tenses, the common ones first) rather than repeating the base form: learners must recognize the word in all its common shapes.
- translation: natural English, not word-for-word.
- cloze: the exact substring of the sentence that realizes the target word, as written there (same case, accents and inflection). It must appear in the sentence exactly once as a whole word. For a separable or multi-word form, use the part that carries the meaning.

Return the entries in the requested order.`;
}

const listLemmas = (ls: Ranked[]) =>
  ls.map((l) => `- lemma: ${l.lemma} | pos: ${l.pos}${l.sense ? ` | sense: ${l.sense}` : ""} | rank: ${l.rank}`).join("\n");

type Ranked = Lemma & { rank: number };
type Request = { custom_id: string; params: Anthropic.MessageCreateParamsNonStreaming };

function request(id: string, lemmas: Ranked[]): Request {
  return {
    custom_id: id,
    params: {
      model: MODEL,
      max_tokens: 16000,
      system: [{ type: "text", text: system(), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Write entries for these lemmas:\n${listLemmas(lemmas)}\n` }],
      output_config: { format: format(WordList) },
    },
  };
}

/** Runs requests through the Batches API (or one by one against the mock, which has no batches). */
async function run(requests: Request[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (mock) {
    for (const r of requests) out.set(r.custom_id, text(await client.messages.create(r.params)));
    return out;
  }
  let batch = await client.messages.batches.create({ requests });
  console.log(`batch ${batch.id}: ${requests.length} requests submitted`);
  while (batch.processing_status !== "ended") {
    await Bun.sleep(30_000);
    batch = await client.messages.batches.retrieve(batch.id);
    const c = batch.request_counts;
    console.log(`  ${batch.processing_status}: ${c.processing} processing, ${c.succeeded} succeeded, ${c.errored} errored`);
  }
  for await (const r of await client.messages.batches.results(batch.id)) {
    if (r.result.type === "succeeded") out.set(r.custom_id, text(r.result.message));
    else console.warn(`  ${r.custom_id}: ${r.result.type}`);
  }
  return out;
}

/** Problems with one generated entry beyond the schema; empty when it's fine. */
function problems(w: SourceWord): string[] {
  const out: string[] = [];
  if (w.pos === "noun" && !w.gender) out.push("noun without gender");
  if (w.pos === "noun" && lang === "es" && w.gender === "n") out.push("Spanish has no neuter nouns");
  for (const s of w.sentences) {
    if (wordCount(s.text) > MAX_SENTENCE_WORDS) out.push(`sentence over ${MAX_SENTENCE_WORDS} words: ${s.text}`);
    if (wholeWordCount(s.text, s.cloze) !== 1) out.push(`cloze "${s.cloze}" is not exactly once in: ${s.text}`);
  }
  return out;
}

async function generate(lemmas: Ranked[]): Promise<Map<number, SourceWord>> {
  const done = new Map<number, SourceWord>();
  let todo = lemmas;
  for (let round = 1; round <= 3 && todo.length; round++) {
    const size = round === 1 ? group : Math.max(1, Math.floor(group / 2));
    const groups: Ranked[][] = [];
    for (let i = 0; i < todo.length; i += size) groups.push(todo.slice(i, i + size));
    const results = await run(groups.map((g, i) => request(`r${round}-g${i}`, g)));
    groups.forEach((g, i) => {
      const raw = results.get(`r${round}-g${i}`);
      let words: unknown[] = [];
      try {
        words = raw ? ((JSON.parse(raw) as { words?: unknown[] }).words ?? []) : [];
      } catch {
        console.warn(`  r${round}-g${i}: output is not JSON`);
      }
      for (const l of g) {
        const match = words.find((w) => (w as SourceWord)?.lemma?.normalize("NFC").toLowerCase() === l.lemma.toLowerCase() && (w as SourceWord).pos === l.pos);
        const parsed = SourceWord.safeParse(match);
        if (!parsed.success) {
          console.warn(`  ${l.lemma}: ${match ? `invalid (${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message})` : "missing"}`);
          continue;
        }
        const word: SourceWord = { ...parsed.data, lemma: l.lemma, ...(l.sense ? { sense: l.sense } : {}) };
        const p = problems(word);
        if (p.length) console.warn(`  ${l.lemma}: ${p.join("; ")}`);
        else done.set(l.rank, word);
      }
    });
    todo = todo.filter((l) => !done.has(l.rank));
    if (todo.length && round < 3) console.log(`retrying ${todo.length} entries…`);
  }
  if (todo.length) console.warn(`gave up on: ${todo.map((l) => l.lemma).join(", ")}`);
  return done;
}

// ---- Output ----------------------------------------------------------------

function append(words: SourceWord[]) {
  const dir = join(deckDir(lang), "source");
  mkdirSync(dir, { recursive: true });
  const files = sourceFiles(lang);
  let file = files.at(-1);
  let current: SourceWord[] = file ? JSON.parse(readFileSync(file, "utf8")) : [];
  let n = files.length;
  if (!file) file = join(dir, `${String(++n).padStart(4, "0")}.json`);
  for (const w of words) {
    if (current.length >= WORDS_PER_FILE) {
      writeFileSync(file, toJson(current));
      file = join(dir, `${String(++n).padStart(4, "0")}.json`);
      current = [];
    }
    current.push(w);
  }
  writeFileSync(file, toJson(current));
}

function text(m: Anthropic.Message): string {
  if (m.stop_reason === "refusal") throw new Error("the model refused");
  return m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

/** A JSON schema output format without the client-side parse helper (batches take plain params). */
function format(schema: z.ZodType): Anthropic.JSONOutputFormat {
  const f = zodOutputFormat(schema);
  return { type: f.type, schema: f.schema };
}

const lemmas = (await newLemmas()).map((l, i) => ({ ...l, rank: from + i }));
console.log(`${lemmas.length} new lemmas: ${lemmas.map((l) => l.lemma).join(", ")}`);
const done = await generate(lemmas);
const words = lemmas.flatMap((l) => (done.has(l.rank) ? [done.get(l.rank)!] : []));
append(words);
console.log(`\nappended ${words.length} words to decks/${lang}/source/. Review them, then run: bun scripts/deck/build.ts ${lang}`);
