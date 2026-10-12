// The languages courses teach (from English, for the MVP). `tag` is the BCP 47
// tag used for speech synthesis and word segmentation.

export interface Language {
  code: string;
  name: string;
  tag: string;
}

export const COURSE_LANGUAGES: (Language & { blurb: string })[] = [
  { code: "es", name: "Spanish", tag: "es-ES", blurb: "Spain and Latin America" },
  { code: "de", name: "German", tag: "de-DE", blurb: "Germany, Austria and Switzerland" },
];

export const language = (code: string): Language =>
  COURSE_LANGUAGES.find((l) => l.code === code) ?? { code, name: code, tag: code };
