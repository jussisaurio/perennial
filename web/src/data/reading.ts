// Which words of a sentence the learner has grown: after a card's answer shows,
// they get a faint tint, so the learner sees how much of real text they can read.
// And a whole sentence they can now read, for the summary (#412).

import { kindOf } from "../content/order";
import { formKey, tokenize } from "../content/text";
import { readMemory, wordState } from "../core/memory";
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

/** A sentence this short is not news: "Es mi casa." */
const READ_MIN_WORDS = 5;

export interface ReadNow {
  id: string;
  text: string;
  translation: string;
}

/**
 * A deck sentence the learner can read whole: every word in it is grown (grammar
 * words too), it has at least READ_MIN_WORDS words, it never came on a card
 * (no review names it) and is not in `shown`. Of those, the one with the most
 * words from `practised` (this session's words), so it is about today.
 */
export function readNow(l: Learner, tag: string, practised: ReadonlySet<string>, shown: ReadonlySet<string>): ReadNow | null {
  const index = formIndex(l);
  const onCards = new Set(l.reviews.map((r) => r.sentence_id));
  const grown = (id: string) => !!readMemory(l, id)?.reps;
  let best: { s: ReadNow; today: number } | null = null;
  for (const list of l.deck.sentencesByWord.values()) {
    for (const s of list) {
      if (onCards.has(s.id) || shown.has(s.id)) continue;
      const words = tokenize(s.text, tag).filter((t) => t.word);
      if (words.length < READ_MIN_WORDS) continue;
      let today = 0;
      const all = words.every((t) => {
        const ids = (index.get(formKey(t.text)) ?? []).filter(grown);
        if (ids.some((id) => practised.has(id))) today++;
        return ids.length > 0;
      });
      if (all && (!best || today > best.today)) best = { s: { id: s.id, text: s.text, translation: s.translation }, today };
    }
  }
  return best?.s ?? null;
}

/**
 * How many of the deck's sentences the learner can read whole: every word in
 * them is known, by the same rule as "You know N words", so the two never disagree.
 * The same text under two words counts once.
 */
export function readableCount(l: Learner, tag: string): number {
  const index = formIndex(l);
  const known = (id: string) => wordState(readMemory(l, id)) === "known";
  const texts = new Set<string>();
  for (const list of l.deck.sentencesByWord.values())
    for (const s of list) if (tokenize(s.text, tag).every((t) => !t.word || (index.get(formKey(t.text)) ?? []).some(known))) texts.add(s.text);
  return texts.size;
}
