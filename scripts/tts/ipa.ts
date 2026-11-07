// IPA for a word, to pin how Chirp 3 HD says it (#776). From WikiPron (Wiktionary data, CC BY-SA),
// used only to make audio. The words checked for #776 were fixed with these files, at this commit.

import type { DeckLang } from "../../web/src/deck/langs.ts";

const WIKIPRON = "https://raw.githubusercontent.com/CUNY-CL/wikipron/d282e848a211ea31cfd730f0ced8bc8cdab9e83d/data/scrape/tsv";
/** es is Castilian: the voice is es-ES. */
export const WIKIPRON_FILE: Record<DeckLang, string> = { de: "deu_latn_broad.tsv", es: "spa_latn_ca_broad.tsv" };
export const wikipronUrl = (lang: DeckLang) => `${WIKIPRON}/${WIKIPRON_FILE[lang]}`;

/** WikiPron's tab-separated "word<TAB>p h o n e s" lines, by word. A word may have several entries. */
export function parseWikipron(tsv: string): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const line of tsv.split("\n")) {
    const [w, p] = line.split("\t");
    if (!w || !p) continue;
    m.set(w, [...(m.get(w) ?? []), p.replace(/ /g, "")]);
  }
  return m;
}

/**
 * Rewrites an entry into the phones Chirp 3 HD takes (probed for #776; it answers 400 to others).
 * de-DE refuses ː after any vowel but a and i, ø, the non-syllabic mark, syllabic l and m, nasal
 * vowels, ɑ, ɾ and ʔ. es-ES refuses the soft stops β ð ɣ and ʝ: their plain letters say the same there.
 */
function forChirp(lang: DeckLang, ipa: string): string {
  if (lang === "es") return ipa.replace(/β/g, "b").replace(/ð/g, "d").replace(/ɣ/g, "ɡ").replace(/ʝ/g, "j");
  return ipa
    .normalize("NFD")
    .replace(/̯/g, "")
    .replace(/([^ai])ː/g, "$1")
    .replace(/ø/g, "œ")
    .replace(/l̩/g, "əl")
    .replace(/m̩/g, "əm")
    .replace(/̃/g, "")
    .replace(/ɑ/g, "a")
    .replace(/ɾ/g, "ʁ")
    .replace(/ʔ/g, "")
    .normalize("NFC");
}

/** Hand-written, in Chirp's phones, for words whose dictionary entries did not fix them (#776). */
const HAND: Partial<Record<DeckLang, Record<string, string[]>>> = {
  de: { Tod: ["ˈtoɐt", "ˈtot"], hart: ["haʁt", "ˈhaɐt"], arm: ["aʁm", "ˈaɐm"], gehe: ["ˈɡeə", "ɡe.ə"] },
};

/**
 * The IPAs to try for a word, best first: hand-written ones, then entries that start with the
 * word's first letter ("gut" [ɡuːt] before [juːt]), then the length nearest the spelling
 * ("haben" [haːbən] before [ham]).
 */
export function ipasFor(lang: DeckLang, word: string, dict: Map<string, string[]>): string[] {
  const first = word[0]!.toLowerCase();
  const score = (p: string) => (p.replace(/ɡ/g, "g")[0] === first ? 0 : 100) + Math.abs(p.length - word.length);
  // `??`: German nouns are capitalized in the deck, and WikiPron lists some words only in lower case.
  const entries = [...new Set(dict.get(word) ?? dict.get(word.toLowerCase()) ?? [])].sort((a, b) => score(a) - score(b));
  return [...new Set([...(HAND[lang]?.[word] ?? []), ...entries.map((p) => forChirp(lang, p))])];
}
