// Word segmentation and coverage. Intl.Segmenter handles languages without
// spaces (Japanese, Chinese, Thai) as well as alphabetic ones.

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

export interface FreqEntry {
  form: string;
  count: number;
}

/** Parse a FrequencyWords list ("word count" per line). */
export function parseFrequencyList(body: string, limit = 50_000): FreqEntry[] {
  const out: FreqEntry[] = [];
  for (const line of body.split("\n")) {
    const sp = line.lastIndexOf(" ");
    if (sp <= 0) continue;
    const count = Number(line.slice(sp + 1));
    if (!Number.isFinite(count)) continue;
    out.push({ form: formKey(line.slice(0, sp)), count });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Share of running text made up of known forms, weighted by corpus frequency.
 * Forms outside the list are ignored. Because the list is truncated at 50k
 * forms, this slightly overstates real coverage — fine for a progress meter.
 */
export function coverage(freq: readonly FreqEntry[], known: ReadonlySet<string>): number {
  let total = 0;
  let hit = 0;
  for (const { form, count } of freq) {
    total += count;
    if (known.has(form)) hit += count;
  }
  return total ? hit / total : 0;
}

/** Find the substring of `sentence` matching any of `forms`, case-insensitively, on word boundaries. */
export function findForm(sentence: string, forms: readonly string[], tag: string): string | null {
  const wanted = new Set(forms.map(formKey));
  for (const t of tokenize(sentence, tag)) if (t.word && wanted.has(formKey(t.text))) return t.text;
  // Segmenters for unspaced scripts may split differently from the forms we
  // were given. Alphabetic languages must match whole words.
  if (!/^(ja|zh|th|lo|km|my)/.test(tag)) return null;
  for (const f of forms) {
    const i = sentence.toLocaleLowerCase().indexOf(formKey(f));
    if (f && i >= 0) return sentence.slice(i, i + f.length);
  }
  return null;
}

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
