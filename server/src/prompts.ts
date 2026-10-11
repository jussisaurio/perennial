// Prompts and response validators for content generation.

export interface GenExample {
  text: string;
  translation: string;
  cloze: string;
}

export interface GenLexeme {
  lemma: string;
  gloss: string;
  pos: string;
  forms: string[];
  notes?: string;
  examples: GenExample[];
}

const str = (x: unknown, field: string): string => {
  if (typeof x !== "string") throw new Error(`${field} must be a string`);
  return x.trim();
};

function example(x: unknown): GenExample | null {
  const o = x as Record<string, unknown>;
  try {
    return { text: str(o.text, "text"), translation: str(o.translation, "translation"), cloze: str(o.cloze, "cloze") };
  } catch {
    return null;
  }
}

function lexeme(x: unknown): GenLexeme | null {
  const o = x as Record<string, unknown>;
  if (!o || typeof o.lemma !== "string" || typeof o.gloss !== "string") return null;
  return {
    lemma: o.lemma.trim(),
    gloss: o.gloss.trim(),
    pos: typeof o.pos === "string" ? o.pos : "",
    forms: Array.isArray(o.forms) ? o.forms.filter((f): f is string => typeof f === "string") : [],
    notes: typeof o.notes === "string" && o.notes.trim() ? o.notes.trim() : undefined,
    examples: Array.isArray(o.examples) ? o.examples.map(example).filter((e): e is GenExample => !!e) : [],
  };
}

const list = <T>(key: string, item: (x: unknown) => T | null) => (x: unknown): T[] => {
  const arr = Array.isArray(x) ? x : (x as Record<string, unknown>)?.[key];
  if (!Array.isArray(arr)) throw new Error(`expected {"${key}": [...]}`);
  return arr.map(item).filter((v): v is T => v !== null);
};

export const validateLexemes = list("words", lexeme);
export const validateExamples = list("examples", (x) => {
  const o = x as Record<string, unknown>;
  const e = example(o);
  return e && typeof o.lemma === "string" ? { ...e, lemma: o.lemma } : null;
});

const TEACHER = (lang: string, native: string) =>
  `You are an expert ${lang} teacher writing study material for a learner whose native language is ${native}. ` +
  `Your sentences are natural, idiomatic, and what a native speaker would actually say in everyday life. ` +
  `Glosses and translations are in ${native}.`;

function knownClause(known: string[]): string {
  if (known.length === 0)
    return "The learner is a complete beginner. Write very short sentences (3–6 words) using only the most basic, high-frequency words.";
  return (
    `The learner already knows these words: ${known.join(", ")}.\n` +
    `Write comprehensible-input sentences: apart from the target word, use mostly words from that list. ` +
    `If you need other words, use only very common ones. Keep sentences short (4–10 words) and vary their topics and structures.`
  );
}

export function frequencyBatchPrompt(lang: string, native: string, forms: string[], known: string[], existingLemmas: string[]) {
  return {
    system: TEACHER(lang, native),
    user:
      `Below are the next most frequent word forms from a ${lang} subtitle corpus, in frequency order:\n` +
      `${forms.join(", ")}\n\n` +
      `Turn them into dictionary entries for a learner:\n` +
      `- Map each form to its lemma (dictionary form). Merge forms that share a lemma into one entry.\n` +
      `- Skip proper names, interjection noise, foreign words, and fragments. Skip lemmas the learner already has: ${existingLemmas.slice(-300).join(", ") || "(none)"}.\n` +
      `- "gloss": a short ${native} meaning (1–4 words; separate distinct senses with "; ").\n` +
      `- "forms": every form from the list above that belongs to this lemma, lowercase, plus the lemma itself.\n` +
      `- "notes": optional, one short line on usage, gender, or irregularity a beginner must know. Omit if obvious.\n` +
      `- "examples": exactly 3 sentences using the word in its most common sense(s). "cloze" is the exact substring of "text" that realizes the word (as inflected in that sentence).\n\n` +
      `${knownClause(known)}\n\n` +
      `Shape: {"words":[{"lemma":"","gloss":"","pos":"noun|verb|adj|adv|pron|prep|conj|det|num|particle|phrase","forms":[""],"notes":"","examples":[{"text":"","translation":"","cloze":""}]}]}`,
  };
}

export function moreExamplesPrompt(lang: string, native: string, words: { lemma: string; gloss: string; seen: string[] }[], known: string[]) {
  return {
    system: TEACHER(lang, native),
    user:
      `Write 3 NEW example sentences for each of these words. Make them different from the sentences the learner has already seen (listed), ` +
      `and use the word in varied contexts and inflections.\n\n` +
      words.map((w) => `- ${w.lemma} (${w.gloss}); already seen: ${w.seen.map((s) => `"${s}"`).join(" ")}`).join("\n") +
      `\n\n${knownClause(known)}\n\n` +
      `"cloze" is the exact substring of "text" that realizes the word.\n` +
      `Shape: {"examples":[{"lemma":"","text":"","translation":"","cloze":""}]}`,
  };
}

export function minePrompt(lang: string, native: string, items: { form: string; sentence: string }[], known: string[]) {
  return {
    system: TEACHER(lang, native),
    user:
      `The learner found these words while reading and wants to learn them. For each, give a dictionary entry. ` +
      `The first example MUST be the original sentence exactly as given (text unchanged), with its ${native} translation; then add 2 more sentences of your own.\n\n` +
      items.map((i) => `- "${i.form}" in: ${i.sentence}`).join("\n") +
      `\n\n${knownClause(known)}\n\n` +
      `"forms": the given form and the lemma, lowercase. "cloze" is the exact substring of "text" that realizes the word.\n` +
      `Shape: {"words":[{"lemma":"","gloss":"","pos":"","forms":[""],"notes":"","examples":[{"text":"","translation":"","cloze":""}]}]}`,
  };
}
