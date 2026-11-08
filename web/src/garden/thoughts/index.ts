// What a thing in the garden makes you think when you tap it (#864): a short
// line in the course language, like the notes gated by known words. A course
// with no entry here fails the typecheck.

import { inLang, type PerLang } from "../nouns";
import type { SceneryId } from "../scenery";
import type { Thought } from "./thought";
import { THOUGHTS as de } from "./de";
import { THOUGHTS as es } from "./es";

/** Every course's thoughts; the story's list (story.ts) reads them too. */
export const THOUGHTS: PerLang<readonly Thought[]> = { es, de };

/** The newest line this thing has for a learner who knows `known` words (ui/visitors.ts knownWords), or null before its first. */
export function thoughtFor(lang: string, id: SceneryId, known: number): string | null {
  let best: Thought | null = null;
  // `?? []`: a course without thoughts (one with no scenery words) has none to show.
  for (const t of inLang(THOUGHTS, lang) ?? []) if (t.thing === id && t.unlockAt <= known && (!best || t.unlockAt > best.unlockAt)) best = t;
  return best?.text ?? null;
}
