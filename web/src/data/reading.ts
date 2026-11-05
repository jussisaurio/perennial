// Which words of a sentence the learner has grown: after a card's answer shows,
// they get a faint tint, so the learner sees how much of real text they can read.

import { kindOf } from "../content/order";
import { formKey, tokenize } from "../content/text";
import { readMemory } from "../core/memory";
import type { Learner } from "./learner";

/** Each form (lowercase) and the words it can be a form of. Built once per learner. */
const indexes = new WeakMap<Learner, Map<string, string[]>>();
function formIndex(l: Learner): Map<string, string[]> {
  let index = indexes.get(l);
  if (index) return index;
  index = new Map();
  for (const w of l.words.values()) for (const f of new Set([w.lemma, ...w.forms].map(formKey))) index.set(f, [...(index.get(f) ?? []), w.id]);
  indexes.set(l, index);
  return index;
}

/**
 * Where the sentence's grown words are: [start, end) in `text`. Grammar words
 * (de, que, und) are left out: they come first in the course, so they would
 * light up every sentence and say nothing about progress. So is `wordId`, the
 * word the card asks about.
 */
export function grownSpans(l: Learner, text: string, tag: string, wordId: string): [number, number][] {
  const index = formIndex(l);
  const spans: [number, number][] = [];
  for (const t of tokenize(text, tag)) {
    if (!t.word) continue;
    const ids = index.get(formKey(t.text)) ?? [];
    if (ids.includes(wordId)) continue;
    const grown = ids.some((id) => {
      const w = l.words.get(id)!; // !: the index is built from l.words
      return kindOf(w.pos) !== "function" && !!readMemory(l, id)?.reps;
    });
    if (grown) spans.push([t.index, t.index + t.text.length]);
  }
  return spans;
}
