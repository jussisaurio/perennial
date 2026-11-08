// The gardener's notes (#654): what one note is. The system (notes/read.ts,
// the shed's nails, the paper card) and the writing (es.ts, de.ts) share it.

/** The share of the course's live words a learner knows when the last note comes and the mouse door opens (#882). */
export const ENDING_SHARE = 0.9;

interface Written {
  /** Stable id, "n01"…, and "d1"… for the pages only in the diary; read state keys on it. */
  id: string;
  /** The note, in the course language. Line breaks are kept. */
  text: string;
  /** Surface forms whose deck lemma differs, lower case: "fui" → "ir". */
  forms?: Readonly<Record<string, string>>;
  /** A page of the gardener's diary on the hill (#858): kept there, not on the shed's nails. */
  diary?: true;
}

/**
 * A note as written. The last one, the door's (#882), has no count of its own:
 * it comes at ENDING_SHARE of the course, so it moves when the deck grows.
 */
export type WrittenNote = Written & ({ beat: "early" | "stile" | "lookout" | "late"; unlockAt: number } | { beat: "door" });

export interface Note extends Written {
  beat: WrittenNote["beat"];
  /** Known words (reading) the learner needs before it appears. */
  unlockAt: number;
}
