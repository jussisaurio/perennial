// One description of a word's plant for every garden: the strip on Today, the
// walk-in garden and the landing page all build their plants here, so the same
// word has the same stage, height, lean and wording everywhere. The
// stage itself follows plantStage (data/learner.ts), next to wordState.

import { courseOrder } from "../content/order";
import { DAY_MS } from "../core/day";
import type { LoadedDeck } from "../data/deck";
import { firstReviewed, isStrong, memKey, OLD_S, plantStage, recall, type PlantStage } from "../core/memory";
import type { Learner } from "../data/learner";
import { hash01 } from "../lib/seed";
import { runAll } from "../lib/yield";
import type { Stage } from "../ui/plant";
import { orchardInput, orchardTrees, plantedAt, type OrchardTree } from "./orchard";
import type { Met } from "./well";
import { leanDeg, type GardenPlant, type Planting } from "./world";

export { leanDeg, type GardenPlant };

/** Below this recall a plant is thirsty: its card asks for practice and it says so. */
export const THIRSTY = 0.85;

interface FirstWord {
  id: string;
  lemma: string;
  /** The first review (ms). */
  at: number;
}

/** The plants of one garden, and the seeds still waiting. */
export interface PlantSource {
  plants: GardenPlant[];
  /** Words set aside after they were planted: their places in the beds stay empty (world.ts layout). */
  aside: Planting[];
  seeds: number;
  /** The learner's first word and when it was planted, for its keepsake (#61) and the orchard's bench (#315). */
  first?: FirstWord | null;
  /** The trees in the orchard behind the hedge (#315): every orchard word started. */
  orchard: OrchardTree[];
  /** Every plant's word and when it was first met, for the orchard well's echo (#335 S6). */
  met: Met[];
}

/** Height from 0 to 1: grows fast at first, then slower; full height at about four months of stability. */
export function growthOf(s: number): number {
  return Math.min(1, Math.log1p(s) / Math.log1p(120));
}

/** An old friend: in bloom and known for a long time. On a full moon its edge shines silver in the walk (#361). */
export function isOld(p: { s: number; stage: Stage }): boolean {
  return p.stage === "bloom" && p.s >= OLD_S;
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

/**
 * The first word the learner ever practised that is still in the garden, or
 * null. From each word's cached first reading review (firstReviewed), not a
 * walk of every review: a new learner costs one lookup per reviewed word
 * (#486). Two words first read in the same ms (a pinned clock in tests): the
 * word whose reviews came first wins, as in the review table's order.
 */
function firstWord(l: Pick<Learner, "words" | "reviewsByWord">): FirstWord | null {
  let best: FirstWord | null = null;
  for (const [id, list] of l.reviewsByWord) {
    const w = l.words.get(id);
    if (!w || w.status === "ignored") continue;
    const at = firstReviewed(list).read;
    if (at !== Infinity && (!best || at < best.at)) best = { id, lemma: w.lemma, at };
  }
  return best;
}

/** The learner's garden: every word with progress is a plant, in course rank order. */
export function plantsFromLearner(l: Learner, now = Date.now()): PlantSource {
  return runAll(plantSteps(l, now));
}

/** plantsFromLearner a step at a time, so Today's first load can work it out in slices (#569). */
export function* plantSteps(l: Learner, now: number): Generator<void, PlantSource> {
  const plants: GardenPlant[] = [];
  const aside: Planting[] = [];
  for (const m of l.memories) {
    yield;
    const w = l.words.get(m.wordId);
    if (m.skill !== "read" || !w) continue;
    const stage = plantStage(m);
    if (stage === "seed") continue;
    if (w.status === "ignored") {
      aside.push({ id: w.id, lemma: w.lemma, rank: w.rank, planted: plantedAt(l, w.id) });
      continue;
    }
    const r = recall(m, now);
    plants.push({
      id: w.id,
      lemma: w.lemma,
      gloss: w.gloss,
      pos: w.pos ?? "",
      rank: w.rank,
      planted: plantedAt(l, w.id),
      s: m.s,
      r,
      stage,
      growth: growthOf(m.s),
      listen: isStrong(l.memory.get(memKey(w.id, "listen"))),
      write: isStrong(l.memory.get(memKey(w.id, "write"))),
      forms: w.forms,
      gender: w.gender,
      garden: w.garden,
    });
  }
  plants.sort((a, b) => a.rank - b.rank);
  yield;
  const met = plants.map((p) => ({ lemma: p.lemma, at: p.planted }));
  yield;
  const first = firstWord(l);
  yield;
  return { plants, aside, seeds: l.fresh().length, first, orchard: orchardTrees(orchardInput(l), now), met };
}

const SHOWCASE_SPAN = 160;
/** The showcase learner's new words a day. */
const SHOWCASE_PER_DAY = 6;

/**
 * A made-up but believable garden for the landing page: the first words of the
 * course at a spread of stages, so newcomers see what learning will look like.
 * The same word looks the same in the strip and in the walk.
 */
// `now` defaults to the clock: the landing page shows a garden planted up to today.
export function showcasePlants(deck: LoadedDeck, count: number, now = Date.now()): PlantSource {
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
      // Planted in course order, a few words a day, the span's last ones today; by the span, not `count`, so a word has the same day in a small showcase as in a big one.
      const planted = now - Math.floor((SHOWCASE_SPAN - 1 - i) / SHOWCASE_PER_DAY) * DAY_MS;
      return { id: w.id, lemma: w.lemma, gloss: w.gloss, pos: w.pos ?? "", rank: w.rank, planted, s, r, stage, growth: growthOf(s), listen: s > 60, write: s > 90, forms: w.forms, gender: w.gender, garden: w.garden };
    });
  // The landing page's door stays locked: nothing grows behind it, and there is no well to echo.
  return { plants, aside: [], seeds: Math.max(0, deck.words.length - count), orchard: [], met: [] };
}

/** The landing page's walk: the same words, at the same stages, as its strip, without seeds to water (it is view-only). */
export function showcaseWalkPlants(deck: LoadedDeck, count = 160): PlantSource {
  return { ...showcasePlants(deck, count), seeds: 0 };
}
