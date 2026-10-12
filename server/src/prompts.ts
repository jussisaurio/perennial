// Prompts for Perennial AI (personal extras). The course itself is static decks.

interface GenSentence {
  text: string;
  translation: string;
  cloze: string;
}

export interface GenWord {
  lemma: string;
  gloss: string;
  pos: string;
  forms: string[];
  notes?: string;
  examples: GenSentence[];
}

/** Bump when a prompt changes, so ai_request rows show which version wrote what. */
export const PROMPT_VERSION = "2026-10-11";

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
