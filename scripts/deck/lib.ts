// Deck build: source files + id manifest (+ the previous deck) → published deck.
// Pure apart from the file helpers at the bottom, so check.ts can rebuild in
// memory and tests can drive it with a seeded id generator.

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Result, Schema, SchemaIssue } from "effect";
import { Deck, GARDEN_WORDS, ID_ALPHABET, ORCHARD_WORDS, SourceWord, deckProblems, manifestKey, type DeckSentence, type DeckWord } from "../../web/src/deck/schema.ts";
import { locate } from "../../web/src/content/text.ts";

export const ROOT = join(import.meta.dir, "../..");
export const deckDir = (lang: string) => join(ROOT, "decks", lang);
export const WORDS_PER_FILE = 100;

/**
 * Decodes `input` against `schema`, reporting every problem at once (not just
 * the first one hit), so an author sees every mistake in a file in one pass.
 */
export function decode<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): { success: true; data: S["Type"] } | { success: false; issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> } {
  const result = Schema.decodeUnknownResult(schema, { errors: "all" })(input);
  if (Result.isSuccess(result)) return { success: true, data: result.success };
  const issues = SchemaIssue.makeFormatterStandardSchemaV1()(result.failure.issue).issues;
  // A path segment is always a plain PropertyKey in practice; normalize the few
  // Standard Schema forms that allow a `{ key }` wrapper too. `path` itself is
  // undefined for an issue on the decoded value as a whole (no property to name).
  return { success: false, issues: issues.map((i) => ({ path: (i.path ?? []).map((p) => (typeof p === "object" ? p.key : p)), message: i.message })) };
}

export const Manifest = Schema.Struct({
  words: Schema.Record(Schema.String, Schema.mutableKey(Schema.String)),
  sentences: Schema.Record(Schema.String, Schema.mutableKey(Schema.String)),
});
export interface Manifest extends Schema.Schema.Type<typeof Manifest> {}

/** Alias file: { duplicateWordId: targetWordId }, written by hand. Read-only, so a plain (readonly-value) record. */
const Aliases = Schema.Record(Schema.String, Schema.String);

/**
 * Garden file: which word brings which garden thing (#209), the word as
 * "lemma|pos" or "lemma|pos|sense". Apart from the source, so adding one does
 * not change an approved source file. A list, so a thing or a word named twice is seen.
 */
const Garden = Schema.Array(Schema.Struct({ garden: Schema.Literals(GARDEN_WORDS), word: Schema.String }));
export type Garden = Schema.Schema.Type<typeof Garden>;

/** Orchard file (#315): which word plants which orchard tree, written like the garden file. */
const Orchard = Schema.Array(Schema.Struct({ orchard: Schema.Literals(ORCHARD_WORDS), word: Schema.String }));
export type Orchard = Schema.Schema.Type<typeof Orchard>;

const sentenceKey = (wordId: string, text: string) => `${wordId}|${text.normalize("NFC")}`;

/** Ten random base32 characters (32 divides 256, so `& 31` is unbiased). */
function randomBody(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => ID_ALPHABET[b & 31]).join("");
}

export type BuildInput = {
  lang: string;
  source: SourceWord[];
  manifest: Manifest;
  prev: Deck | null;
  aliases?: { readonly [id: string]: string };
  garden?: Garden;
  orchard?: Orchard;
  /** Injectable for tests. */
  newBody?: () => string;
};

export type BuildResult = { deck: Deck; manifest: Manifest; errors: string[]; warnings: string[] };

export function buildDeck({ lang, source, manifest, prev, aliases = {}, garden = [], orchard = [], newBody = randomBody }: BuildInput): BuildResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prevWords = new Map(prev?.words.map((w) => [w.id, w]));
  const prevSentences = new Map(prev?.sentences.map((s) => [s.id, s]));

  // Every id ever handed out, so a fresh one never collides or comes back.
  const used = new Set([...Object.values(manifest.words), ...Object.values(manifest.sentences), ...prevWords.keys(), ...prevSentences.keys()]);
  const fresh = (kind: "w" | "s") => {
    for (;;) {
      const id = `${lang}.${kind}.${newBody()}`;
      if (!used.has(id)) return used.add(id), id;
    }
  };
  // Existing ids are kept, except a retired one: un-retiring is not allowed, so
  // an entry that comes back gets a new id.
  const assign = (map: Record<string, string>, key: string, kind: "w" | "s", retired: (id: string) => boolean) => {
    const known = map[key];
    if (known && !retired(known)) return known;
    return (map[key] = fresh(kind));
  };

  const next: Manifest = { words: { ...manifest.words }, sentences: { ...manifest.sentences } };
  const words: DeckWord[] = [];
  const liveSentences = new Map<string, DeckSentence[]>();
  const seenKeys = new Set<string>();

  source.forEach((src, i) => {
    const key = manifestKey(src);
    if (seenKeys.has(key)) errors.push(`source word ${i + 1} (${src.lemma}): duplicate of an earlier word; add a "sense" to tell them apart`);
    seenKeys.add(key);
    const id = assign(next.words, key, "w", (id) => !!prevWords.get(id)?.retired);
    words.push(clean({ id, lemma: src.lemma, gloss: src.gloss, pos: src.pos, sense: src.sense, rank: i + 1, forms: src.forms, notes: src.notes, gender: src.gender }));
    const texts = new Set<string>();
    const list: DeckSentence[] = [];
    for (const s of src.sentences) {
      if (texts.has(s.text)) errors.push(`${src.lemma}: sentence "${s.text}" appears twice`);
      texts.add(s.text);
      const sid = assign(next.sentences, sentenceKey(id, s.text), "s", (sid) => !!prevSentences.get(sid)?.retired);
      list.push({ id: sid, wordId: id, text: s.text, translation: s.translation, cloze: s.cloze });
      const hits = wholeWordCount(s.text, s.cloze);
      if (hits !== 1) warnings.push(`${src.lemma}: cloze "${s.cloze}" occurs ${hits}× as a whole word in "${s.text}"`);
    }
    // Inflected words should be met in several forms, not one form repeated.
    const clozes = new Set(list.map((s) => s.cloze.toLowerCase()));
    if (src.forms.length > 1 && clozes.size === 1) warnings.push(`${src.lemma}: every sentence uses the form "${list[0].cloze}"; vary the forms`);
    liveSentences.set(id, list);
  });

  // Garden and orchard words name a live source word each, and a word names one thing.
  // A thing named twice is a deck problem (deckProblems).
  const live = new Map(words.map((w) => [manifestKey(w), w]));
  const name = (file: string, word: string, thing: string, set: (w: DeckWord) => void) => {
    const [lemma, pos, sense] = word.split("|");
    const w = live.get(manifestKey({ lemma, pos, sense }));
    if (!w) errors.push(`${file}: "${word}" (${thing}) is not a live word in the source`);
    else if (w.garden || w.orchard) errors.push(`${file}: "${word}" is named for both "${w.garden ?? w.orchard}" and "${thing}"`);
    else set(w);
  };
  for (const g of garden) name("garden.json", g.word, g.garden, (w) => (w.garden = g.garden));
  for (const o of orchard) name("orchard.json", o.word, o.orchard, (w) => (w.orchard = o.orchard));

  // Words and sentences that left the source stay in the deck, retired.
  const liveIds = new Set(words.map((w) => w.id));
  for (const w of prev?.words ?? []) if (!liveIds.has(w.id)) words.push({ ...w, retired: true, aliasOf: undefined, garden: undefined, orchard: undefined });
  for (const w of words) {
    const target = aliases[w.id];
    if (target) w.aliasOf = target;
    else delete w.aliasOf;
  }
  for (const id of Object.keys(aliases)) if (!words.some((w) => w.id === id)) errors.push(`aliases.json: unknown word ${id}`);

  // Stable order: by rank (retired words keep their old rank), live first, then id.
  words.sort((a, b) => a.rank - b.rank || Number(!!a.retired) - Number(!!b.retired) || a.id.localeCompare(b.id));
  const sentences: DeckSentence[] = [];
  for (const w of words) {
    const live = liveSentences.get(w.id) ?? [];
    const liveSids = new Set(live.map((s) => s.id));
    sentences.push(...live);
    for (const s of prev?.sentences ?? []) if (s.wordId === w.id && !liveSids.has(s.id)) sentences.push({ ...s, retired: true });
  }

  let deck: Deck = { lang: lang as Deck["lang"], native: "en", version: prev?.version ?? 1, words, sentences };
  // Parsing also puts keys in schema order, the same order a read gives.
  const parsed = decode(Deck(lang), deck);
  if (parsed.success) deck = parsed.data;
  else errors.push(...parsed.issues.map((i) => `deck.${i.path.join(".")}: ${i.message}`));
  const content = (d: Deck) => JSON.stringify([d.words, d.sentences]);
  if (prev && content(prev) !== content(deck)) deck.version = prev.version + 1;
  errors.push(...deckProblems(deck));
  return { deck, manifest: sortManifest(next), errors, warnings };
}

/** Drops undefined/empty optional fields so the JSON stays tidy and stable. */
function clean(w: DeckWord): DeckWord {
  const out = { ...w } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === undefined || out[k] === "") delete out[k];
  return out as DeckWord;
}

function sortManifest(m: Manifest): Manifest {
  const sort = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return { words: sort(m.words), sentences: sort(m.sentences) };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** How often `cloze` appears in `text` not flanked by letters (Unicode aware). */
export function wholeWordCount(text: string, cloze: string): number {
  return [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{M}])${escape(cloze)}(?![\\p{L}\\p{M}])`, "gu"))].length;
}

/** Words a sentence may have before the proofreader is asked to look at its length. */
export const MAX_SENTENCE_WORDS = 12;

/** Words in a sentence. Spaces at the ends or doubled spaces don't count as words. */
export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Automatic hints on one sentence for the proofreader: too long, the cloze not exactly once, the cloze not a listed form. */
export function sentenceFlags(s: { text: string; cloze: string }, forms: readonly string[]): string[] {
  const flags: string[] = [];
  const n = wordCount(s.text);
  if (n > MAX_SENTENCE_WORDS) flags.push(`${n} words`);
  const c = wholeWordCount(s.text, s.cloze);
  if (c !== 1) flags.push(c === 0 ? "cloze not found as a whole word" : `cloze appears ${c}×`);
  if (!forms.some((f) => f.toLowerCase() === s.cloze.toLowerCase())) flags.push(`cloze "${s.cloze}" not in forms`);
  return flags;
}

/** The sentence with its cloze between `open` and `close`, at the whole-word match the app uses. */
export function markCloze(text: string, cloze: string, open: string, close: string): string {
  const i = locate(text, cloze);
  return i < 0 ? text : `${text.slice(0, i)}${open}${cloze}${close}${text.slice(i + cloze.length)}`;
}

export const toJson = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

/** The value after `--name` in a command line, or undefined when the flag is absent. */
export function flagValue(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

// ---- Files ------------------------------------------------------------------

export const sourcePath = (lang: string, num: string) => join(deckDir(lang), "source", `${num}.json`);

export function sourceFiles(lang: string): string[] {
  const dir = join(deckDir(lang), "source");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f)).sort().map((f) => join(dir, f));
}

/** All source words in rank order, validated; errors name the file and index. */
export function readSource(lang: string): { words: SourceWord[]; errors: string[] } {
  const words: SourceWord[] = [];
  const errors: string[] = [];
  for (const file of sourceFiles(lang)) {
    const rel = file.slice(ROOT.length + 1);
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(raw)) {
      errors.push(`${rel}: expected an array of words`);
      continue;
    }
    if (raw.length > WORDS_PER_FILE) errors.push(`${rel}: ${raw.length} words, at most ${WORDS_PER_FILE} per file`);
    raw.forEach((w, i) => {
      const r = decode(SourceWord, w);
      if (r.success) words.push(r.data);
      else errors.push(...r.issues.map((is) => `${rel}[${i}] ${(w as { lemma?: string })?.lemma ?? ""}.${is.path.join(".")}: ${is.message}`));
    });
  }
  return { words, errors };
}

function readJson<S extends Schema.ConstraintDecoder<unknown>, F>(path: string, schema: S, fallback: F): S["Type"] | F {
  return existsSync(path) ? Schema.decodeUnknownSync(schema)(JSON.parse(readFileSync(path, "utf8"))) : fallback;
}

/** Every course names its garden (#209) and orchard (#315) words, so a missing file is a mistake, not "none". */
function readNamed<S extends Schema.ConstraintDecoder<unknown>>(path: string, schema: S): S["Type"] {
  if (!existsSync(path)) throw new Error(`${path.slice(ROOT.length + 1)} is missing: every course names its garden and orchard words (docs/decks.md)`);
  return Schema.decodeUnknownSync(schema)(JSON.parse(readFileSync(path, "utf8")));
}

export function readDeckFiles(lang: string) {
  const dir = deckDir(lang);
  return {
    manifest: readJson(join(dir, "ids.json"), Manifest, { words: {}, sentences: {} }),
    prev: readJson(join(dir, "deck.json"), Deck(lang), null),
    aliases: readJson(join(dir, "aliases.json"), Aliases, {}),
    garden: readNamed(join(dir, "garden.json"), Garden),
    orchard: readNamed(join(dir, "orchard.json"), Orchard),
  };
}

export function writeDeckFiles(lang: string, deck: Deck, manifest: Manifest) {
  const dir = deckDir(lang);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "deck.json"), toJson(deck));
  writeFileSync(join(dir, "ids.json"), toJson(manifest));
}
