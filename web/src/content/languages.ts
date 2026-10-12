// The languages courses teach (from English, for the MVP): one per deck
// language. `tag` is the BCP 47 tag used for speech synthesis and word
// segmentation.

import { DECK_LANGS, type DeckLang } from "../deck/schema";

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

export const language = (code: string): Language =>
  COURSE_LANGUAGES.find((l) => l.code === code) ?? { code, name: code, tag: code };
