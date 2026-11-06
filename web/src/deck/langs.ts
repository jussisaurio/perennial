// The languages with a deck. Apart from deck/schema.ts so that code drawn before
// the first paint can use them without loading Effect's Schema (#569).

export const DECK_LANGS = ["es", "de"] as const;
export type DeckLang = (typeof DECK_LANGS)[number];
export const isDeckLang = (s: string): s is DeckLang => (DECK_LANGS as readonly string[]).includes(s);
