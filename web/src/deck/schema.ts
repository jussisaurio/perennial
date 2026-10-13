// The deck format, shared by the build scripts, the server and the client.
//
// Authors (people, or a model through scripts/deck/generate.ts) write *source*
// entries without ids. scripts/deck/build.ts assigns stable ids from the
// committed manifest and writes the published deck. See docs/schema.md.

import { z } from "zod";

export const DECK_LANGS = ["es", "de"] as const;
export type DeckLang = (typeof DECK_LANGS)[number];
export const isDeckLang = (s: string): s is DeckLang => (DECK_LANGS as readonly string[]).includes(s);

/** Parts of speech, as decks spell them. Groupings (garden beds, course order) are built from these. */
export const POS = ["noun", "verb", "adj", "adv", "pron", "prep", "conj", "det", "num", "particle", "phrase", "interj"] as const;
export type Pos = (typeof POS)[number];

/** Spelled-out names, as an AI-written word of the learner's own may have them. */
const POS_NAMES: Record<string, Pos> = {
  adjective: "adj",
  adverb: "adv",
  pronoun: "pron",
  preposition: "prep",
  conjunction: "conj",
  determiner: "det",
  article: "det",
  number: "num",
  interjection: "interj",
};

/** A part of speech as decks spell it ("Adjective" → "adj"), or null when it is none of them. */
export function toPos(s: string | null | undefined): Pos | null {
  const p = (s ?? "").trim().toLowerCase();
  return (POS as readonly string[]).includes(p) ? (p as Pos) : (POS_NAMES[p] ?? null);
}

/**
 * Garden words (#209): things a learner can bring into the garden by learning
 * the word for them. Every course marks one word for each (`garden` on a deck
 * word). Learners meet them in this order, early and steadily (content/order.ts).
 * Ids are stable: progress and garden art are keyed by them.
 */
export const GARDEN_WORDS = [
  "cat", "bird", "dog", "sun", "fish", "rain", "butterfly", "moon", "frog", "bee", "snow", "snail", "star",
  "mouse", "wind", "duck", "cloud", "rabbit", "owl", "fox", "rainbow", "spider", "hedgehog", "squirrel", "ant",
] as const;
export type GardenWord = (typeof GARDEN_WORDS)[number];

/** Id bodies are ten of these: lowercase base32 without i, l, o, u, to avoid confusion. */
export const ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const wordId = (lang: string) => z.string().regex(new RegExp(`^${lang}\\.w\\.[${ID_ALPHABET}]{10}$`));
const sentenceId = (lang: string) => z.string().regex(new RegExp(`^${lang}\\.s\\.[${ID_ALPHABET}]{10}$`));

const text = (max: number) => z.string().trim().min(1).max(max);

// ---- Source (what authors write) -----------------------------------------

const SourceSentence = z.object({
  text: text(200),
  translation: text(240),
  cloze: text(60),
});

export const SourceWord = z.object({
  lemma: text(60),
  gloss: text(120),
  pos: z.enum(POS),
  /** Distinguishes two senses that share lemma and part of speech ("banco": bank / bench). */
  sense: z.string().trim().max(40).optional(),
  forms: z.array(text(60)).min(1).max(40),
  notes: z.string().trim().max(300).optional(),
  gender: z.enum(["m", "f", "n", "mf"]).optional(),
  /** This word brings that thing into the garden; the course places it, not its rank. */
  garden: z.enum(GARDEN_WORDS).optional(),
  sentences: z.array(SourceSentence).min(3).max(8),
});
export type SourceWord = z.infer<typeof SourceWord>;

// ---- Published deck (what ships) ------------------------------------------

export const DeckWord = (lang: string) =>
  z.object({
    id: wordId(lang),
    lemma: text(60),
    gloss: text(120),
    pos: z.enum(POS),
    sense: z.string().optional(),
    rank: z.number().int().positive(),
    forms: z.array(text(60)).min(1),
    notes: z.string().optional(),
    gender: z.enum(["m", "f", "n", "mf"]).optional(),
    garden: z.enum(GARDEN_WORDS).optional(),
    retired: z.boolean().optional(),
    aliasOf: wordId(lang).optional(),
  });

export const DeckSentence = (lang: string) =>
  z.object({
    id: sentenceId(lang),
    wordId: wordId(lang),
    text: text(200),
    translation: text(240),
    cloze: text(60),
    retired: z.boolean().optional(),
  });

export const Deck = (lang: string) =>
  z.object({
    lang: z.literal(lang),
    native: z.literal("en"),
    version: z.number().int().positive(),
    words: z.array(DeckWord(lang)),
    sentences: z.array(DeckSentence(lang)),
  });

export type DeckWord = z.infer<ReturnType<typeof DeckWord>>;
export type DeckSentence = z.infer<ReturnType<typeof DeckSentence>>;
export type Deck = z.infer<ReturnType<typeof Deck>>;

/** Manifest: (lemma, pos, sense) → id, so regenerating content keeps ids. */
export const manifestKey = (w: { lemma: string; pos: string; sense?: string }) => `${w.lemma.normalize("NFC").toLowerCase()}|${w.pos}|${w.sense ?? ""}`;

/**
 * Invariants a single deck must satisfy beyond its schema. Returns problems,
 * empty when the deck is fine.
 */
export function deckProblems(deck: Deck): string[] {
  const out: string[] = [];
  const words = new Map(deck.words.map((w) => [w.id, w]));
  if (words.size !== deck.words.length) out.push("duplicate word ids");
  const sentenceIds = new Set<string>();
  const live = new Map<string, number>();
  const keys = new Set<string>();
  const garden = new Set<string>();
  for (const s of deck.sentences) {
    if (sentenceIds.has(s.id)) out.push(`duplicate sentence id ${s.id}`);
    sentenceIds.add(s.id);
    if (!words.has(s.wordId)) out.push(`sentence ${s.id} points at unknown word ${s.wordId}`);
    if (!s.text.includes(s.cloze)) out.push(`sentence ${s.id}: cloze "${s.cloze}" is not in "${s.text}"`);
    if (s.cloze.length >= s.text.length) out.push(`sentence ${s.id}: cloze is the whole sentence`);
    if (!s.retired) live.set(s.wordId, (live.get(s.wordId) ?? 0) + 1);
  }
  for (const w of deck.words) {
    if (w.aliasOf) {
      const target = words.get(w.aliasOf);
      if (!target) out.push(`word ${w.id} is an alias of unknown ${w.aliasOf}`);
      else if (target.aliasOf) out.push(`word ${w.id} is an alias of an alias (${w.aliasOf})`);
      else if (target.retired) out.push(`word ${w.id} is an alias of retired ${w.aliasOf}`);
      continue;
    }
    if (w.retired) continue;
    const key = manifestKey(w);
    if (keys.has(key)) out.push(`two live words share lemma, part of speech and sense: ${key}`);
    keys.add(key);
    if (w.garden) {
      if (garden.has(w.garden)) out.push(`two live words bring the garden "${w.garden}"`);
      garden.add(w.garden);
    }
    if ((live.get(w.id) ?? 0) < 3) out.push(`word ${w.id} (${w.lemma}) has fewer than 3 live sentences`);
  }
  return out;
}

/**
 * Compatibility of a new deck version with the last released one. Errors
 * block the change; `retiredShare` lets CI ask for approval on big changes.
 */
export function compatibility(prev: Deck, next: Deck): { errors: string[]; added: number; edited: number; retired: number; retiredShare: number } {
  const errors: string[] = [];
  if (next.version < prev.version) errors.push(`version went down: ${prev.version} → ${next.version}`);
  const nextWords = new Map(next.words.map((w) => [w.id, w]));
  const nextSentences = new Map(next.sentences.map((s) => [s.id, s]));
  let edited = 0;
  let retired = 0;
  for (const w of prev.words) {
    const n = nextWords.get(w.id);
    if (!n) {
      errors.push(`word ${w.id} (${w.lemma}) was removed; retire it instead`);
      continue;
    }
    if (n.pos !== w.pos) errors.push(`word ${w.id} changed part of speech (${w.pos} → ${n.pos}): use a new id`);
    if (w.retired && !n.retired) errors.push(`word ${w.id} was un-retired`);
    // Reviews of an alias are unioned with its target, so the link is permanent.
    if (w.aliasOf && n.aliasOf !== w.aliasOf) errors.push(`word ${w.id} changed alias (${w.aliasOf} → ${n.aliasOf ?? "none"})`);
    // A word folded into another as an alias keeps its progress: not counted as retired.
    if (!w.retired && n.retired && !n.aliasOf) retired++;
    else if (n.lemma !== w.lemma || n.gloss !== w.gloss || n.notes !== w.notes || n.gender !== w.gender || n.forms.join() !== w.forms.join()) edited++;
  }
  for (const s of prev.sentences) {
    const n = nextSentences.get(s.id);
    if (!n) errors.push(`sentence ${s.id} was removed; retire it instead`);
    else if (n.wordId !== s.wordId) errors.push(`sentence ${s.id} moved to another word`);
    else if (s.retired && !n.retired) errors.push(`sentence ${s.id} was un-retired`);
  }
  const prevIds = new Set(prev.words.map((w) => w.id));
  const added = next.words.filter((w) => !prevIds.has(w.id)).length;
  const liveBefore = prev.words.filter((w) => !w.retired && !w.aliasOf).length || 1;
  return { errors, added, edited, retired, retiredShare: retired / liveBefore };
}
