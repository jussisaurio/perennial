// The languages courses teach (from English, for the MVP): one per deck
// language. `tag` is the BCP 47 tag used for speech synthesis and word
// segmentation.

import { DECK_LANGS, isDeckLang, type DeckLang } from "../deck/schema";

export interface Language {
  code: string;
  name: string;
  tag: string;
}

const COURSES: Record<DeckLang, Omit<Language, "code"> & { blurb: string }> = {
  es: { name: "Spanish", tag: "es-ES", blurb: "Spain and Latin America" },
  de: { name: "German", tag: "de-DE", blurb: "Germany, Austria and Switzerland" },
};

export const COURSE_LANGUAGES: (Language & { blurb: string })[] = DECK_LANGS.map((code) => ({ code, ...COURSES[code] }));

/**
 * The courses this build can teach. A course in a newer language can sync here
 * from another device before this app reloads to the new version. This build
 * has no deck for it, so the course waits until then.
 */
export const teachable = <T extends { lang: string }>(courses: T[]): T[] => courses.filter((c) => isDeckLang(c.lang));

/**
 * A course language. Codes are checked where they enter: synced courses by
 * `teachable`, the onboarding draft by isDeckLang, choices from COURSE_LANGUAGES.
 * So any other code is a bug.
 */
export function language(code: string): Language {
  const l = COURSE_LANGUAGES.find((x) => x.code === code);
  if (!l) throw new Error(`no course language "${code}"`);
  return l;
}
