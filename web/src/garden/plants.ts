// One description of a word's plant for every garden: the strip on Today, the
// walk-in garden and the landing page all build their plants here, so the same
// word has the same stage, height, lean, mood and wording everywhere. The
// stage itself follows plantStage (data/learner.ts), next to wordState.

import { courseOrder } from "../content/order";
import type { PLANT_LINES } from "../content/voice";
import type { LoadedDeck } from "../data/deck";
import { isStrong, memKey, OLD_S, plantStage, recall, type PlantStage } from "../core/memory";
import type { Learner } from "../data/learner";
import { hash01 } from "../lib/seed";
import type { Stage } from "../ui/plant";
import { leanDeg, leanDir, type GardenPlant } from "./world";

export { leanDeg, leanDir, type GardenPlant };

/** Below this recall a plant is thirsty: its card asks for practice and it says so. */
export const THIRSTY = 0.85;

export interface FirstWord {
  id: string;
  lemma: string;
  /** The first review (ms). */
  at: number;
}

/** The plants of one garden, and the seeds still waiting. */
export interface PlantSource {
  plants: GardenPlant[];
  seeds: number;
  /** The learner's first word and when it was planted, for its keepsake (#61). */
  first?: FirstWord | null;
}

/** Height from 0 to 1: grows fast at first, then slower; full height at about four months of stability. */
export function growthOf(s: number): number {
  return Math.min(1, Math.log1p(s) / Math.log1p(120));
}

export type PlantMood = keyof typeof PLANT_LINES;

/** The plant's mood for its line of personality: thirsty first, then an old friend, else its stage. */
export function plantMood(p: { s: number; r: number; stage: Stage }): PlantMood {
  if (p.r < THIRSTY) return "thirsty";
  if (p.stage === "bloom" && p.s >= OLD_S) return "old";
  return p.stage;
}

const STAGE_LABEL: Record<PlantStage, string> = { seed: "a seed", sprout: "a new sprout", bud: "budding", bloom: "in bloom" };
const STAGE_MEANING: Record<PlantStage, string> = { seed: "you have not started this word", sprout: "you are learning this word", bud: "you almost know this word", bloom: "you know this word" };

/** The stage in words: "in bloom", "budding", "a new sprout" or "a seed". */
export function stageLabel(stage: PlantStage): string {
  return STAGE_LABEL[stage];
}

/** The stage as a sentence for a plant's card: "In bloom: you know this word." */
export function stageSentence(stage: PlantStage): string {
  const label = STAGE_LABEL[stage];
  return `${label[0].toUpperCase()}${label.slice(1)}: ${STAGE_MEANING[stage]}.`;
}

/** The first word the learner ever practised that is still in the garden, or null. */
function firstWord(l: Learner): FirstWord | null {
  let best: { id: string; at: number } | null = null;
  for (const r of l.reviews) {
    if (r.skill !== "read") continue;
    const at = Date.parse(r.reviewed_at);
    if (best && at >= best.at) continue;
    const id = l.resolve(r.word_id);
    const w = l.words.get(id);
    if (w && w.status !== "ignored") best = { id, at };
  }
  return best ? { id: best.id, lemma: l.words.get(best.id)!.lemma, at: best.at } : null;
}

/** The learner's garden: every word with progress is a plant, in course rank order. */
export function plantsFromLearner(l: Learner, now = Date.now()): PlantSource {
  const plants: GardenPlant[] = [];
  for (const m of l.memories) {
    const w = l.words.get(m.wordId);
    if (m.skill !== "read" || !w || w.status === "ignored") continue;
    const stage = plantStage(m);
    if (stage === "seed") continue;
    const r = recall(m, now);
    plants.push({
      id: w.id,
      lemma: w.lemma,
      gloss: w.gloss,
      pos: w.pos ?? "",
      rank: w.rank,
      s: m.s,
      r,
      stage,
      growth: growthOf(m.s),
      listen: isStrong(l.memory.get(memKey(w.id, "listen"))),
      write: isStrong(l.memory.get(memKey(w.id, "write"))),
      garden: w.garden,
    });
  }
  plants.sort((a, b) => a.rank - b.rank);
  return { plants, seeds: l.fresh().length, first: firstWord(l) };
}

const SHOWCASE_SPAN = 160;

/**
 * A made-up but believable garden for the landing page: the first words of the
 * course at a spread of stages, so newcomers see what learning will look like.
 * The same word looks the same in the strip and in the walk.
 */
export function showcasePlants(deck: LoadedDeck, count: number): PlantSource {
  const r = 0.92;
  const plants = courseOrder(deck)
    .slice(0, count)
    .map((w, i): GardenPlant => {
      const h = hash01(w.id, 7);
      // Mostly blooming, some budding, a few sprouts; common words grew longest.
      // Over a fixed span, not `count`, so a word is as tall in a small showcase as in a big one.
      const s = h < 0.15 ? 1 + h * 10 : h < 0.35 ? 3 + h * 8 : 8 + (1 - Math.min(i, SHOWCASE_SPAN) / SHOWCASE_SPAN) * 120 * h;
      // Every showcase word has been practised a few times, so the stage follows stability alone.
      const stage = plantStage({ s, reps: 3 }) as Stage;
      return { id: w.id, lemma: w.lemma, gloss: w.gloss, pos: w.pos ?? "", rank: w.rank, s, r, stage, growth: growthOf(s), listen: s > 60, write: s > 90, garden: w.garden };
    });
  return { plants, seeds: Math.max(0, deck.words.length - count) };
}
