// Word segmentation. Intl.Segmenter handles languages without spaces
// (Japanese, Chinese, Thai) as well as alphabetic ones.

export interface Token {
  text: string;
  word: boolean;
  index: number;
}

export function tokenize(text: string, tag: string): Token[] {
  const seg = new Intl.Segmenter(tag, { granularity: "word" });
  return [...seg.segment(text)].map((s) => ({ text: s.segment, word: !!s.isWordLike, index: s.index }));
}

export const formKey = (s: string) => s.normalize("NFC").toLocaleLowerCase().trim();

/**
 * Index of `part` in `text`, preferring an occurrence that stands as a whole
 * word ("de" in "¿Dónde está de…" should not match inside "Dónde"). Unspaced
 * scripts have no boundaries, so they fall back to the first occurrence.
 */
export function locate(text: string, part: string): number {
  if (!part) return -1;
  const isLetter = (ch: string | undefined) => !!ch && /[\p{L}\p{M}\p{N}]/u.test(ch);
  let first = -1;
  for (let i = text.indexOf(part); i >= 0; i = text.indexOf(part, i + 1)) {
    if (first < 0) first = i;
    if (!isLetter(text[i - 1]) && !isLetter(text[i + part.length])) return i;
  }
  return first;
}
