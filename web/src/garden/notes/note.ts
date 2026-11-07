// The gardener's notes (#654): what one note is. The system (notes/read.ts,
// the shed's nails, the paper card) and the writing (es.ts, de.ts) share it.

export interface Note {
  /** Stable id, "n01"…; read state keys on it. */
  id: string;
  beat: "early" | "stile" | "lookout" | "late" | "door";
  /** Known words (reading) the learner needs before it appears. */
  unlockAt: number;
  /** The note, in the course language. Line breaks are kept. */
  text: string;
  /** Surface forms whose deck lemma differs, lower case: "fui" → "ir". */
  forms?: Readonly<Record<string, string>>;
}
