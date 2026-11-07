// Plain UI copy (docs/voice.md): the clear thing, then stop. No jokes in UI
// sentences; the garden's whimsy lives in the world itself.

import { inLang, type PerLang } from "../garden/nouns";

/** The walk's card when there are no plants yet. */
export const EMPTY_WALK = { title: "Nothing planted yet.", body: "Each word you learn grows into a plant here.", cta: "Plant my first words" } as const;
/** "Reserved", per course language: small under the strip stake's English, and alone on the walk's stake (#650). */
export const RESERVED: PerLang<string> = { es: "Reservado", de: "Reserviert" };

/** The stake in an empty strip: the clear line in English, and the course language's word small below. */
export function reservedStake(langName: string, code: string): { line: string; local?: string } {
  // No word for a course without a deck: the English line is enough.
  return { line: `Reserved for ${langName} words`, local: inLang(RESERVED, code) ?? undefined };
}

export type WordsFilter = "all" | "known" | "learning" | "new" | "suspended" | "mine";

/** A search that finds nothing: under All the course has no such word; elsewhere it may be in another list (#262). */
const SEARCH_MISS: Record<WordsFilter, string> = {
  all: "No word like this in the course.",
  known: "No known word like this. Try All.",
  learning: "No word like this in progress. Try All.",
  new: "No new word like this. Try All.",
  suspended: "No paused word like this. Try All.",
  mine: "No word like this from your texts. Try All.",
};

/** The Words list with no rows: what is missing. */
export function wordsEmptyLine(filter: WordsFilter, searching: boolean): string {
  // "All" is the whole course, so it is empty only under a search.
  if (searching || filter === "all") return SEARCH_MISS[filter];
  return {
    known: "No known words yet.",
    learning: "No words in progress right now.",
    new: "No new words left in the course.",
    suspended: "No paused words.",
    mine: "No words from your texts yet.",
  }[filter];
}

/** Under the garden on the first session's summary. */
export const firstPlantsLine = (n: number) => (n === 1 ? "Your first plant." : `Your first ${n} plants.`);

/** The summary's first line, in the past tense, leaving out a part that is zero: "You planted 3 seeds and watered 21 plants." */
export function didLine(seeds: number, watered: number): string {
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const parts = [seeds > 0 && `planted ${count(seeds, "seed")}`, watered > 0 && `watered ${count(watered, "plant")}`].filter(Boolean);
  return `You ${parts.join(" and ")}.`;
}

/** Shown once on the landing page after an account is deleted. */
export function farewell(lang: string | null): { line: string; wish?: string } {
  return { line: "Your garden is gone. Thank you for growing it.", wish: lang === "de" ? "Viel Glück." : lang === "es" ? "¡Buena suerte!" : undefined };
}
