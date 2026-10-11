// Content generation through Perennial AI, the hosted service. It needs a
// signed-in account; without one there is no AI and callers fall back to
// words added by hand.

import { api, getSession } from "../hosted/api";
import type { Course } from "../model";
import { language } from "../content/languages";

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

export type AIMode = "hosted";

/** "hosted" when signed in (Perennial AI is available), otherwise null. */
export async function aiMode(): Promise<AIMode | null> {
  return (await getSession()) ? "hosted" : null;
}

/** Who wrote a piece of content: stored on each sentence. */
export interface Author {
  origin: "hosted";
  model: string;
}

/** The author new content would get right now, or null without AI. */
export async function currentAuthor(): Promise<Author | null> {
  return (await aiMode()) ? { origin: "hosted", model: "Perennial AI" } : null;
}

const common = (course: Course) => ({ lang: course.lang, language: language(course.lang).name, native: course.native });

export async function generateCourseBatch(course: Course, batch: { forms: string[]; cursor: number; next: number }): Promise<{ words: GenLexeme[]; next: number; by: Author }> {
  // Shared course: the server's cached batch defines where the next one starts.
  const r = await api<{ words: GenLexeme[]; next: number; model: string }>("/ai/course-batch", { ...common(course), ...batch });
  return { words: r.words, next: r.next, by: { origin: "hosted", model: r.model } };
}

export async function mineWords(course: Course, items: { form: string; sentence: string }[], known: string[]): Promise<{ words: GenLexeme[]; by: Author }> {
  const r = await api<{ words: GenLexeme[]; model: string }>("/ai/mine", { ...common(course), items, known });
  return { words: r.words, by: { origin: "hosted", model: r.model } };
}

export async function moreExamples(
  course: Course,
  words: { lemma: string; gloss: string; seen: string[] }[],
  known: string[],
): Promise<{ examples: (GenExample & { lemma: string })[]; by: Author }> {
  const r = await api<{ examples: (GenExample & { lemma: string })[]; model: string }>("/ai/examples", { ...common(course), words, known });
  return { examples: r.examples, by: { origin: "hosted", model: r.model } };
}
