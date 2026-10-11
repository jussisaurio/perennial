// Where content generation runs: Perennial's hosted AI (signed in), or the
// learner's own provider. Callers don't need to know which.

import { getMeta, setMeta } from "../db/db";
import { api, getCachedMe, getSession } from "../hosted/api";
import type { Course } from "../model";
import { language } from "../content/languages";
import { askJSON, getLLMConfig, isLocalUrl } from "./llm";
import { frequencyBatchPrompt, minePrompt, moreExamplesPrompt, validateExamples, validateLexemes, type GenExample, type GenLexeme } from "./prompts";

export type AIMode = "hosted" | "own";

/** The learner's explicit choice, if any. */
export const getAIPreference = () => getMeta<AIMode | null>("aiMode", null);
export const setAIPreference = (m: AIMode) => setMeta("aiMode", m);

/** Which backend is usable right now, or null when there is none. */
export async function aiMode(): Promise<AIMode | null> {
  const [pref, session, own] = await Promise.all([getAIPreference(), getSession(), getLLMConfig()]);
  if (pref === "own" && own) return "own";
  if (session) return "hosted";
  return own ? "own" : null;
}

/** Who wrote a piece of content: stored on each sentence. */
export interface Author {
  origin: "hosted" | "own" | "local";
  model: string;
}

async function ownAuthor(): Promise<Author> {
  const cfg = await getLLMConfig();
  return { origin: cfg && isLocalUrl(cfg.baseUrl) ? "local" : "own", model: cfg?.model ?? "unknown" };
}

/** The author new content would get right now, or null without AI. */
export async function currentAuthor(): Promise<Author | null> {
  const mode = await aiMode();
  if (mode === "own") return ownAuthor();
  if (mode === "hosted") return { origin: "hosted", model: "Perennial AI" };
  return null;
}

const common = (course: Course) => ({ lang: course.lang, language: language(course.lang).name, native: course.native });

export async function generateCourseBatch(
  course: Course,
  batch: { forms: string[]; cursor: number; next: number },
  context: { known: string[]; existing: string[] },
): Promise<{ words: GenLexeme[]; next: number; by: Author }> {
  if ((await aiMode()) === "hosted") {
    // Shared course: the server's cached batch defines where the next one starts.
    const r = await api<{ words: GenLexeme[]; next: number; model: string }>("/ai/course-batch", { ...common(course), ...batch });
    return { words: r.words, next: r.next, by: { origin: "hosted", model: r.model } };
  }
  const p = frequencyBatchPrompt(language(course.lang).name, course.native, batch.forms, context.known, context.existing);
  return { words: await askJSON(p.system, p.user, validateLexemes), next: batch.next, by: await ownAuthor() };
}

export async function mineWords(course: Course, items: { form: string; sentence: string }[], known: string[]): Promise<{ words: GenLexeme[]; by: Author }> {
  if ((await aiMode()) === "hosted") {
    const r = await api<{ words: GenLexeme[]; model: string }>("/ai/mine", { ...common(course), items, known });
    return { words: r.words, by: { origin: "hosted", model: r.model } };
  }
  const p = minePrompt(language(course.lang).name, course.native, items, known);
  return { words: await askJSON(p.system, p.user, validateLexemes), by: await ownAuthor() };
}

export async function moreExamples(
  course: Course,
  words: { lemma: string; gloss: string; seen: string[] }[],
  known: string[],
): Promise<{ examples: (GenExample & { lemma: string })[]; by: Author }> {
  if ((await aiMode()) === "hosted") {
    const r = await api<{ examples: (GenExample & { lemma: string })[]; model: string }>("/ai/examples", { ...common(course), words, known });
    return { examples: r.examples, by: { origin: "hosted", model: r.model } };
  }
  const p = moreExamplesPrompt(language(course.lang).name, course.native, words, known);
  return { examples: await askJSON(p.system, p.user, validateExamples), by: await ownAuthor() };
}

/**
 * Background sentence refresh spends credits on the hosted free plan, so it
 * only runs when it costs the learner nothing they'd notice.
 */
export async function canRefreshInBackground(): Promise<boolean> {
  const mode = await aiMode();
  if (mode === "own") return true;
  if (mode === "hosted") return (await getCachedMe())?.plan === "pro";
  return false;
}
