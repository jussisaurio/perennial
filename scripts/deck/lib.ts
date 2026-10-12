// Deck build: source files + id manifest (+ the previous deck) → published deck.
// Pure apart from the file helpers at the bottom, so check.ts can rebuild in
// memory and tests can drive it with a seeded id generator.

import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Deck, SourceWord, deckProblems, manifestKey, type DeckSentence, type DeckWord } from "../../web/src/deck/schema.ts";

export const ROOT = join(import.meta.dir, "../..");
export const deckDir = (lang: string) => join(ROOT, "decks", lang);
export const WORDS_PER_FILE = 100;

export const Manifest = z.object({
  words: z.record(z.string(), z.string()),
  sentences: z.record(z.string(), z.string()),
});
export type Manifest = z.infer<typeof Manifest>;

/** Alias file: { duplicateWordId: targetWordId }, written by hand. */
export const Aliases = z.record(z.string(), z.string());

export const sentenceKey = (wordId: string, text: string) => `${wordId}|${text.normalize("NFC")}`;

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
/** Ten random base32 characters (32 divides 256, so `& 31` is unbiased). */
export function randomBody(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join("");
}

export type BuildInput = {
  lang: string;
  source: SourceWord[];
  manifest: Manifest;
  prev: Deck | null;
  aliases?: Record<string, string>;
  /** Injectable for tests. */
  newBody?: () => string;
};

export type BuildResult = { deck: Deck; manifest: Manifest; errors: string[]; warnings: string[] };

export function buildDeck({ lang, source, manifest, prev, aliases = {}, newBody = randomBody }: BuildInput): BuildResult {
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

  // Words and sentences that left the source stay in the deck, retired.
  const liveIds = new Set(words.map((w) => w.id));
  for (const w of prev?.words ?? []) if (!liveIds.has(w.id)) words.push({ ...w, retired: true, aliasOf: undefined });
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
  const parsed = Deck(lang).safeParse(deck);
  if (parsed.success) deck = parsed.data;
  else errors.push(...parsed.error.issues.map((i) => `deck.${i.path.join(".")}: ${i.message}`));
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

/** Automatic hints on one sentence for the proofreader: too long, the cloze not exactly once, the cloze not a listed form. */
export function sentenceFlags(s: { text: string; cloze: string }, forms: readonly string[]): string[] {
  const flags: string[] = [];
  const n = s.text.split(/\s+/).filter(Boolean).length;
  if (n > MAX_SENTENCE_WORDS) flags.push(`${n} words`);
  const c = wholeWordCount(s.text, s.cloze);
  if (c !== 1) flags.push(c === 0 ? "cloze not found as a whole word" : `cloze appears ${c}×`);
  if (!forms.some((f) => f.toLowerCase() === s.cloze.toLowerCase())) flags.push(`cloze "${s.cloze}" not in forms`);
  return flags;
}

export const toJson = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

// ---- Files ------------------------------------------------------------------

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
      const r = SourceWord.safeParse(w);
      if (r.success) words.push(r.data);
      else errors.push(...r.error.issues.map((is) => `${rel}[${i}] ${(w as { lemma?: string })?.lemma ?? ""}.${is.path.join(".")}: ${is.message}`));
    });
  }
  return { words, errors };
}

export function readJson<T>(path: string, schema: z.ZodType<T>, fallback: T): T {
  return existsSync(path) ? schema.parse(JSON.parse(readFileSync(path, "utf8"))) : fallback;
}

export function readDeckFiles(lang: string) {
  const dir = deckDir(lang);
  return {
    manifest: readJson(join(dir, "ids.json"), Manifest, { words: {}, sentences: {} }),
    prev: readJson<Deck | null>(join(dir, "deck.json"), Deck(lang), null),
    aliases: readJson(join(dir, "aliases.json"), Aliases, {}),
  };
}

export function writeDeckFiles(lang: string, deck: Deck, manifest: Manifest) {
  const dir = deckDir(lang);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "deck.json"), toJson(deck));
  writeFileSync(join(dir, "ids.json"), toJson(manifest));
}
