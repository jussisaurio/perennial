// What a thing in the garden makes you think when you tap it (#864): what one
// thought is. The system (thoughts/index.ts, the tag over a thing) and the
// writing (es.ts, de.ts) share it.

import type { Fact } from "../facts";
import type { SceneryId } from "../scenery";

/** The things that have thoughts. Every course has lines for each (thoughts.test.ts). */
type ThoughtThing = Extract<SceneryId, "bench" | "stool" | "pond" | "sunflower" | "sundial" | "hills">;

export interface Thought {
  thing: ThoughtThing;
  /** Known words (reading) the learner needs before it shows: by then the course has taught every word in it. */
  unlockAt: number;
  /** The line, in the course language. Six words at most. */
  text: string;
  /** Surface forms whose deck lemma differs, lower case: "sentaba" → "sentar". */
  forms?: Readonly<Record<string, string>>;
  /** The story's facts (garden/facts.ts) a reader must know from the notes, or this line is ahead of them. It tells none (#884). */
  assumes?: readonly Fact[];
}
