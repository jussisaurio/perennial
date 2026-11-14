// Tools for authors of new source files (docs/decks.md, "Growing the decks").
//
//   bun scripts/deck/draft.ts check  <lang> <NNNN> <draft.json>   a draft against the deck, writing nothing
//   bun scripts/deck/draft.ts near   <lang> <NNNN> [draft.json]    each sentence's closest sentences of other words, ranked
//   bun scripts/deck/draft.ts frames <lang>                         sentence openings the deck already uses 4+ times
//
// `check` and `near` read the draft in place of decks/<lang>/source/<NNNN>.json (`near` without a draft reads
// that file), so parallel authors can check drafts without a broken file ever landing in the source.

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

/** One sentence's match in another word's sentences, for `near`. */
export interface Near {
  score: number;
  by: "frame" | "english";
  lemma: string;
  /** 1-based, as proofreaders name them (s1, s2). */
  sentence: number;
  text: string;
  translation: string;
  other: { lemma: string; text: string; translation: string };
}

/**
 * A token's weight: its inverse document frequency over `docs`, so a shared "tragedy" or "pasillo"
 * counts and a shared "the" or "el" barely does.
 */
function idf(docs: readonly ReadonlySet<string>[]) {
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d) df.set(t, (df.get(t) ?? 0) + 1);
  return (t: string) => {
    const n = df.get(t);
    // Every compared sentence is one of `docs`.
    if (n === undefined) throw new Error(`token not in the deck: ${t}`);
    return Math.log(docs.length / n);
  };
}

/**
 * How much of their weight `mine` and `other` share (a weighted Dice score, 0 to 1). `fits` names the
 * other sentence's words that could fill my blank; the heaviest one is left out, as the learner would
 * put it in the blank. So "No aguanto el calor." (blank: aguanto) matches "No soporto el calor." even
 * when that card's own blank is calor.
 */
function overlap(weight: (t: string) => number, mine: ReadonlySet<string>, other: ReadonlySet<string>, fits: (t: string) => boolean) {
  let shared = 0;
  let unshared = 0;
  let filler = 0;
  for (const t of other)
    if (mine.has(t)) shared += weight(t);
    else {
      unshared += weight(t);
      if (fits(t)) filler = Math.max(filler, weight(t));
    }
  let own = 0;
  for (const t of mine) own += weight(t);
  const all = own + shared + unshared - filler;
  return all === 0 ? 0 : (2 * shared) / all;
}

/** The words before and after each word of a sentence, with "" for its start and end. */
function neighbours(words: readonly string[]) {
  const out = new Map<string, { before: Set<string>; after: Set<string> }>();
  words.forEach((t, i) => {
    const n = out.get(t) ?? { before: new Set<string>(), after: new Set<string>() };
    // "" stands for the start or the end of the sentence, which a blank can sit next to too.
    n.before.add(words[i - 1] ?? "");
    n.after.add(words[i + 1] ?? "");
    out.set(t, n);
  });
  return out;
}

/**
 * Each of `mine`'s sentences against every other word's sentence in `deck` (which holds `mine` too):
 * the `per` closest by frame (my sentence with its target blanked out, the other with the one word blanked
 * that fits best) and the `per` closest by English translation (the same situation, or an older word with
 * the same meaning). Ranked, closest first, from `floor` up. Authors fix the top of this list before
 * proofreading; proofreaders searched for these by hand in #422.
 */
export function nearest(mine: readonly SourceWord[], deck: readonly SourceWord[], per = 2, floor = 0.5): Near[] {
  const doc = (lemma: string, s: Sentence) => {
    const words = tokens(s.text);
    return { lemma, text: s.text, translation: s.translation, words: new Set(words), around: neighbours(words), english: new Set(tokens(s.translation)) };
  };
  const pool = deck.flatMap((w) => w.sentences.map((s) => doc(w.lemma, s)));
  const wordWeight = idf(pool.map((d) => d.words));
  const englishWeight = idf(pool.map((d) => d.english));
  const out: Near[] = [];
  for (const w of mine)
    w.sentences.forEach((s, i) => {
      const frame = new Set(frameOf(s));
      const english = new Set(tokens(s.translation));
      const words = tokens(s.text);
      const at = words.indexOf(s.cloze.toLowerCase());
      // A word fits my blank when it sits next to the same word on either side. A cloze that is not
      // in its sentence (draft.ts check flags it) has no place, so nothing fits.
      const fits = (o: (typeof pool)[number]) => (t: string) => {
        const n = o.around.get(t);
        return at >= 0 && n !== undefined && (n.before.has(words[at - 1] ?? "") || n.after.has(words[at + 1] ?? ""));
      };
      const others = pool.filter((o) => o.lemma !== w.lemma && o.text !== s.text);
      const top = (by: Near["by"], score: (o: (typeof pool)[number]) => number) =>
        others
          .map((o) => ({ o, score: score(o) }))
          .filter((m) => m.score >= floor)
          .sort((a, b) => b.score - a.score)
          .slice(0, per)
          .forEach(({ o, score }) =>
            out.push({ score, by, lemma: w.lemma, sentence: i + 1, text: s.text, translation: s.translation, other: { lemma: o.lemma, text: o.text, translation: o.translation } }),
          );
      // A frame or translation of one or two words matches by chance.
      if (frame.size >= 2) top("frame", (o) => overlap(wordWeight, frame, o.words, fits(o)));
      if (english.size >= 3) top("english", (o) => overlap(englishWeight, english, o.english, () => false));
    });
  return out.sort((a, b) => b.score - a.score);
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

/** A draft file's words that fit the schema, and what is wrong with the file and the others. */
function readDraft(draftPath: string): { draft: SourceWord[]; problems: string[] } {
  const raw = JSON.parse(readFileSync(draftPath, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${draftPath}: expected an array of words`);
  const problems: string[] = raw.length > WORDS_PER_FILE ? [`${raw.length} words, at most ${WORDS_PER_FILE}`] : [];
  const draft: SourceWord[] = [];
  raw.forEach((w, i) => {
    const r = decode(SourceWord, w);
    if (r.success) draft.push(r.data);
    else problems.push(...r.issues.map((is) => `[${i}] ${(w as { lemma?: string }).lemma ?? ""}.${is.path.join(".")}: ${is.message}`));
  });
  return { draft, problems };
}

/** The deck's words outside decks/<lang>/source/<NNNN>.json, which a draft replaces and may not exist yet. */
function placedAndRest(lang: string, num: string, words: readonly SourceWord[]) {
  const path = sourcePath(lang, num);
  const placed = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as SourceWord[]) : [];
  const same = (a: SourceWord, b: SourceWord) => a.lemma === b.lemma && a.pos === b.pos && (a.sense ?? "") === (b.sense ?? "");
  return { placed, rest: words.filter((w) => !placed.some((p) => same(p, w))) };
}

async function check(lang: string, num: string, draftPath: string): Promise<boolean> {
  const { draft, problems } = readDraft(draftPath);
  const source = readSource(lang);
  const { rest } = placedAndRest(lang, num, source.words);
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

/** Prints `nearest` for a draft, or for the file in place when there is no draft. A half-done draft still gets its words ranked. */
function near(lang: string, num: string, draftPath: string | undefined): boolean {
  const { placed, rest } = placedAndRest(lang, num, readSource(lang).words);
  const { draft: mine, problems } = draftPath ? readDraft(draftPath) : { draft: placed, problems: [] };
  for (const p of problems) console.log(`ERROR ${p} (left out; draft.ts check gives every error)`);
  if (mine.length === 0) throw new Error(`no words: give a draft, or a file that is in decks/${lang}/source/`);
  console.log(`# Each sentence's closest sentences of other ${lang} words, closest first. frame: the same words once the other's word goes in the blank; english: the same translation words.`);
  console.log("# Near the top, a learner would likely answer the other word: write a new situation, or make the gloss and translation rule it out (docs/decks.md).");
  const quote = (by: Near["by"], text: string, translation: string) => `"${by === "frame" ? text : translation}"`;
  for (const n of nearest(mine, [...rest, ...mine]))
    console.log(`${n.score.toFixed(2)}  ${n.by.padEnd(7)}  ${n.lemma} s${n.sentence} ${quote(n.by, n.text, n.translation)}  ~  ${n.other.lemma} ${quote(n.by, n.other.text, n.other.translation)}`);
  return problems.length === 0;
}

if (import.meta.main) {
  const [cmd, lang, num, draftPath] = process.argv.slice(2);
  if (cmd === "check" && lang && num && draftPath) process.exit((await check(lang, num, draftPath)) ? 0 : 1);
  else if (cmd === "near" && lang && num) process.exit(near(lang, num, draftPath) ? 0 : 1);
  else if (cmd === "frames" && lang) {
    console.log(`# Openings the ${lang} deck already uses 4+ times (X = that sentence's target word). Don't start a new sentence this way.`);
    for (const [k, n] of wornOpenings(readSource(lang).words)) console.log(`${n}\t${k} …`);
  } else {
    console.error("usage: draft.ts check <lang> <NNNN> <draft.json> | draft.ts near <lang> <NNNN> [draft.json] | draft.ts frames <lang>");
    process.exit(2);
  }
}
