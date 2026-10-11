// Resolving the word ids that user data refers to against a deck version.

import type { Deck, DeckWord } from "./schema";

const indexes = new WeakMap<Deck, Map<string, DeckWord>>();

function index(deck: Deck): Map<string, DeckWord> {
  let m = indexes.get(deck);
  if (!m) indexes.set(deck, (m = new Map(deck.words.map((w) => [w.id, w]))));
  return m;
}

/**
 * The word a stored id stands for: follows `aliasOf` one hop (chains are
 * invalid) and returns the word even when retired, so reviews stay attached.
 * Undefined only for ids this deck doesn't know (e.g. from a newer deck).
 */
export function resolveWordId(deck: Deck, id: string): DeckWord | undefined {
  const w = index(deck).get(id);
  return w?.aliasOf ? (index(deck).get(w.aliasOf) ?? w) : w;
}
