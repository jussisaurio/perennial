// The gardener's notes (#654): what one note is. The system (notes/read.ts,
// the shed's nails, the paper card) and the writing (es.ts, de.ts) share it.

export interface Note {
  /** Stable id, "n01"…, and "d1"… for the pages only in the diary; read state keys on it. */
  id: string;
  beat: "early" | "stile" | "lookout" | "late" | "door";
  /** Known words (reading) the learner needs before it appears. */
  unlockAt: number;
  /** The note, in the course language. Line breaks are kept. */
  text: string;
  /** Surface forms whose deck lemma differs, lower case: "fui" → "ir". */
  forms?: Readonly<Record<string, string>>;
  /** A page of the gardener's diary on the hill (#858): kept there, not on the shed's nails. */
  diary?: true;
}
