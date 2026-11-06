// Tools for authors of new source files (docs/decks.md, "Growing the decks").
//
//   bun scripts/deck/draft.ts check  <lang> <NNNN> <draft.json>   a draft against the deck, writing nothing
//   bun scripts/deck/draft.ts frames <lang>                         sentence openings the deck already uses 4+ times
//
// `check` builds the deck in memory with the draft in place of decks/<lang>/source/<NNNN>.json,
// so parallel authors can check drafts without a broken file ever landing in the source.

import { existsSync, readFileSync } from "node:fs";
import { SourceWord } from "../../web/src/deck/schema.ts";
import { auditDeck, frequencyRanks, loadAllow } from "./audit.ts";
import { WORDS_PER_FILE, buildDeck, decode, readDeckFiles, readSource, sentenceFlags, sourcePath } from "./lib.ts";

type Sentence = SourceWord["sentences"][number];

const tokens = (t: string) => t.toLowerCase().normalize("NFC").split(/[^\p{L}\p{M}]+/u).filter(Boolean);
const dice = (a: readonly string[], b: readonly string[]) => {
  const sa = new Set(a);
  const sb = new Set(b);
  let n = 0;
  for (const t of sa) if (sb.has(t)) n++;
  return (2 * n) / (sa.size + sb.size);
};
// The sentence's words without its target word: what is left when the card blanks it out.
const frameOf = (s: Sentence) => tokens(s.text).filter((t) => t !== s.cloze.toLowerCase());

/**
 * A new sentence that echoes another word's sentence: a learner would answer the other word (#422).
 * near-duplicate: most words are the same. same-frame: the same once both target words are blanked out,
 * a synonym swapped into the slot ("No soporto el calor." / "No aguanto el calor.").
 * Thresholds were tuned on the 0014–0017 proofreading: lower ones flagged mostly "Ich habe X"-style noise.
 */
export function echoes(mine: readonly SourceWord[], deck: readonly SourceWord[]): string[] {
  const pool = deck.flatMap((w) => w.sentences.map((s) => ({ lemma: w.lemma, text: s.text, words: tokens(s.text), frame: frameOf(s) })));
  const out: string[] = [];
  for (const w of mine)
    for (const s of w.sentences) {
      const words = tokens(s.text);
      if (words.length < 3) continue;
      const frame = frameOf(s);
      for (const o of pool) {
        if (o.lemma === w.lemma || o.text === s.text) continue;
        if (dice(words, o.words) >= 0.75) out.push(`near-duplicate ${w.lemma}: "${s.text}" ~ ${o.lemma}: "${o.text}"`);
        else if (frame.length >= 2 && dice(frame, o.frame) >= 0.85) out.push(`same-frame ${w.lemma}: "${s.text}" ~ ${o.lemma}: "${o.text}"`);
      }
    }
  return out;
}

/** Sentence openings (first three words, the target word as X) used at least `min` times: frames a new sentence should not reuse. */
export function wornOpenings(words: readonly SourceWord[], min = 4): [string, number][] {
  const counts = new Map<string, number>();
  for (const w of words)
    for (const s of w.sentences) {
      const start = tokens(s.text.replace(s.cloze, "X")).slice(0, 3);
      if (start.length < 3) continue;
      const key = start.map((t) => (t === "x" ? "X" : t)).join(" ");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  return [...counts].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]);
}

async function check(lang: string, num: string, draftPath: string): Promise<boolean> {
  const raw = JSON.parse(readFileSync(draftPath, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${draftPath}: expected an array of words`);
  const problems: string[] = raw.length > WORDS_PER_FILE ? [`${raw.length} words, at most ${WORDS_PER_FILE}`] : [];
  const draft: SourceWord[] = [];
  raw.forEach((w, i) => {
    const r = decode(SourceWord, w);
    if (r.success) draft.push(r.data);
    else problems.push(...r.issues.map((is) => `[${i}] ${(w as { lemma?: string }).lemma ?? ""}.${is.path.join(".")}: ${is.message}`));
  });
  const source = readSource(lang);
  // The draft replaces its own file, which may already be in place.
  const path = sourcePath(lang, num);
  const placed = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as SourceWord[]) : [];
  const same = (a: SourceWord, b: SourceWord) => a.lemma === b.lemma && a.pos === b.pos && (a.sense ?? "") === (b.sense ?? "");
  const rest = source.words.filter((w) => !placed.some((p) => same(p, w)));
  const { deck, errors, warnings } = buildDeck({ lang, source: [...rest, ...draft], ...readDeckFiles(lang) });
  problems.push(...source.errors, ...errors);
  for (const w of draft) w.sentences.forEach((s, i) => sentenceFlags(s, w.forms).forEach((f) => problems.push(`${w.lemma} s${i + 1}: ${f}`)));
  const lemmas = new Set(draft.map((w) => w.lemma));
  const findings = auditDeck(lang, deck, await frequencyRanks(lang), loadAllow(lang)).findings.filter((f) => f.lemma !== undefined && lemmas.has(f.lemma));
  const echoed = echoes(draft, [...rest, ...draft]);
  for (const p of problems) console.log(`ERROR ${p}`);
  for (const e of echoed) console.log(`WARN ${e}`);
  for (const w of warnings.filter((w) => [...lemmas].some((l) => w.includes(l)))) console.log(`WARN ${w}`);
  for (const f of findings) console.log(`${f.level.toUpperCase()} ${f.code} ${f.lemma}: ${f.message}`);
  const auditErrors = findings.filter((f) => f.level === "error").length;
  console.log(`${draft.length} words checked; ${problems.length} errors, ${echoed.length} echoes, ${auditErrors} audit errors, ${findings.length - auditErrors} audit warnings`);
  return problems.length === 0 && auditErrors === 0;
}

if (import.meta.main) {
  const [cmd, lang, num, draftPath] = process.argv.slice(2);
  if (cmd === "check" && lang && num && draftPath) process.exit((await check(lang, num, draftPath)) ? 0 : 1);
  else if (cmd === "frames" && lang) {
    console.log(`# Openings the ${lang} deck already uses 4+ times (X = that sentence's target word). Don't start a new sentence this way.`);
    for (const [k, n] of wornOpenings(readSource(lang).words)) console.log(`${n}\t${k} …`);
  } else {
    console.error("usage: draft.ts check <lang> <NNNN> <draft.json> | draft.ts frames <lang>");
    process.exit(2);
  }
}
