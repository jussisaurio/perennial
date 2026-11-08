// What the awake frog says once it is tired of croaking (#902): deadpan lines
// in its own bubble, gated by known words like the thoughts. Written in each
// language, not translated; the order is the order it says them.

import { inLang, type PerLang } from "./nouns";
import type { Thought } from "./thoughts/thought";

/** A line is gated and checked like a thought (thoughts.test.ts), but belongs to no thing. */
export type FrogLine = Omit<Thought, "thing">;

/** Every course's lines; the story's list (story.ts) reads them too. */
export const FROG_LINES: PerLang<readonly FrogLine[]> = {
  // Its last line is always "no more words": after it the frog only croaks, with no word. So no line comes before it does.
  es: [
    { unlockAt: 280, text: "¿Otra vez tú?", forms: { otra: "otro" } },
    { unlockAt: 850, text: "Nada de besos, por favor. Esas historias no son verdad.", forms: { besos: "beso", esas: "ese", historias: "historia", son: "ser" } },
    { unlockAt: 920, text: "No soy un príncipe.", forms: { soy: "ser" } },
    { unlockAt: 280, text: "No tengo más palabras.", forms: { tengo: "tener", palabras: "palabra" } },
  ],
  de: [
    { unlockAt: 230, text: "Du schon wieder?" },
    { unlockAt: 990, text: "Bitte keine Küsse. Diese Geschichten stimmen nicht.", forms: { keine: "kein", "küsse": "kuss", diese: "dieser", geschichten: "geschichte" } },
    { unlockAt: 990, text: "Ich bin kein Prinz.", forms: { bin: "sein" } },
    { unlockAt: 230, text: "Ich habe keine Wörter mehr.", forms: { habe: "haben", keine: "kein", "wörter": "wort" } },
  ],
};

/** The lines a learner who knows `known` words (ui/visitors.ts knownWords) can read, in the order the frog says them. */
export function frogLines(lang: string, known: number): string[] {
  // `?? []`: a course with no lines has a frog that only croaks.
  return (inLang(FROG_LINES, lang) ?? []).filter((l) => l.unlockAt <= known).map((l) => l.text);
}
