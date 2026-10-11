// The deck format, shared by the build scripts, the server and the client.
//
// Authors (people, or a model through scripts/deck/generate.ts) write *source*
// entries without ids. scripts/deck/build.ts assigns stable ids from the
// committed manifest and writes the published deck. See docs/schema.md.

import { z } from "zod";

export const DECK_LANGS = ["es", "de"] as const;
export type DeckLang = (typeof DECK_LANGS)[number];

const POS = ["noun", "verb", "adj", "adv", "pron", "prep", "conj", "det", "num", "particle", "phrase", "interj"] as const;

/** Ten lowercase base32 characters (no i, l, o, u to avoid confusion). */
export const ID_BODY = /^[0-9abcdefghjkmnpqrstvwxyz]{10}$/;
export const wordId = (lang: string) => z.string().regex(new RegExp(`^${lang}\\.w\\.[0-9abcdefghjkmnpqrstvwxyz]{10}$`));
export const sentenceId = (lang: string) => z.string().regex(new RegExp(`^${lang}\\.s\\.[0-9abcdefghjkmnpqrstvwxyz]{10}$`));

const text = (max: number) => z.string().trim().min(1).max(max);

// ---- Source (what authors write) -----------------------------------------

export const SourceSentence = z.object({
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
      continue;
    }
    if (!w.retired && (live.get(w.id) ?? 0) < 3) out.push(`word ${w.id} (${w.lemma}) has fewer than 3 live sentences`);
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
    if (!w.retired && n.retired) retired++;
    else if (n.lemma !== w.lemma || n.gloss !== w.gloss || n.notes !== w.notes) edited++;
  }
  for (const s of prev.sentences) {
    const n = nextSentences.get(s.id);
    if (!n) errors.push(`sentence ${s.id} was removed; retire it instead`);
    else if (n.wordId !== s.wordId) errors.push(`sentence ${s.id} moved to another word`);
  }
  const added = next.words.filter((w) => !prev.words.some((p) => p.id === w.id)).length;
  const liveBefore = prev.words.filter((w) => !w.retired && !w.aliasOf).length || 1;
  return { errors, added, edited, retired, retiredShare: retired / liveBefore };
}
