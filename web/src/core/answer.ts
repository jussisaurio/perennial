// Typed-answer checking. Forgiving about things that aren't the point of the
// exercise (case, punctuation, a single typo) and explicit about accents.

export type Verdict = "exact" | "accent" | "typo" | "wrong";

export function normalize(s: string): string {
  return s
    .normalize("NFC")
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripMarks(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
}

/**
 * Positions (in the expected answer) where the given answer differs, for
 * highlighting. Exact for accent slips; the first difference for typos.
 */
export function differences(given: string, expected: string): Set<number> {
  const g = [...normalize(given)];
  const e = [...expected.normalize("NFC")];
  const el = [...normalize(expected)];
  const out = new Set<number>();
  if (g.length === el.length) {
    el.forEach((ch, i) => {
      if (ch !== g[i]) out.add(i);
    });
  } else {
    let i = 0;
    while (i < g.length && i < el.length && g[i] === el[i]) i++;
    if (i < e.length) out.add(i);
  }
  return out;
}

/** German without an umlaut keyboard: ae, oe, ue, ss are the standard spellings. */
const germanSpelling = (s: string) => s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");

export function levenshtein(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

/**
 * Languages where letters like ä, ö, å, ı, ł are letters of their own, not
 * accented variants: "saari" (island) and "sääri" (shin) are different words.
 * German is not on the list: a missing umlaut is a typing problem we accept
 * with a warning, like a missing Spanish accent.
 */
const MARKS_ARE_LETTERS = /^(fi|sv|no|da|et|hu|tr|is|pl|cs|sk|sl|hr|sr|lt|lv|ro|vi)/;

/** Index of the first difference between two strings (after a single edit). */
function firstDiff(a: string[], b: string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

export function check(given: string, expected: string | string[], lang = ""): Verdict {
  const options = Array.isArray(expected) ? expected : [expected];
  const marksMatter = MARKS_ARE_LETTERS.test(lang);
  let best: Verdict = "wrong";
  const g = normalize(given);
  if (!g) return "wrong";
  for (const opt of options) {
    const e = normalize(opt);
    if (g === e) return "exact";
    if (lang.startsWith("de") && germanSpelling(g) === germanSpelling(e)) return "exact";
    // Accents and ñ are hard to type: accepted, but shown as a warning.
    if (!marksMatter && stripMarks(g) === stripMarks(e)) best = "accent";
    else if (best === "wrong") {
      const ec = [...e];
      // One slip inside a longer word is a typo. A difference in the last two
      // letters is usually a different form (case ending, plural, person).
      const gc = [...g];
      const at = firstDiff(gc, ec);
      // Where marked letters are letters of their own, swapping one for its
      // base letter changes the word ("Mutter" mother, "Mütter" mothers).
      const markSwap = marksMatter && gc.length === ec.length && gc[at] !== undefined && stripMarks(gc[at]) === stripMarks(ec[at]);
      if (ec.length >= 5 && levenshtein(g, e) === 1 && at < ec.length - 2 && !markSwap) best = "typo";
    }
  }
  return best;
}

/** Accent slips and single typos still count as recalled. */
export const passes = (v: Verdict) => v !== "wrong";
