// Deck audit: the systematic checks behind ordering and proofreading.
//
//   bun scripts/deck/audit.ts [lang…] [--json]
//
// Duplicates (errors fail CI):
//   - the same sentence twice for one word
//   - two live words with the same lemma and part of speech (also in deckProblems)
// Possible duplicates (warnings, for the proofreader to decide):
//   - the same sentence used for two different words
//   - a lemma that is listed as a form of another word ("hecho" vs "hacer")
//   - a form listed under two words, unless allowed in decks/<lang>/audit-allow.json
//     ({ "forms": ["fui", "fue"] }) because it really belongs to both
// Ease and order (warnings and the per-word table):
//   - frequency rank of each word in the subtitle corpus vs its deck rank (drift);
//     not for garden words, which the course places early on purpose
//   - rare words in sentences: forms outside the corpus top 10 000 (learners won't know them)
//   - comprehensibility: share of a sentence's other words that the learner
//     already met (words earlier in the course, plus the 100 most frequent forms)
//   - cognates: lemmas that look like their English gloss (easy wins)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DECK_LANGS, Deck, type DeckSentence, type DeckWord } from "../../web/src/deck/schema.ts";
import { language } from "../../web/src/content/languages.ts";
import { courseOrder } from "../../web/src/content/order.ts";
import { formKey, tokenize } from "../../web/src/content/text.ts";
import { ROOT, deckDir } from "./lib.ts";

export interface Finding {
  level: "error" | "warn";
  code: string;
  lemma?: string;
  message: string;
}

export interface WordStats {
  rank: number;
  id: string;
  lemma: string;
  pos: string;
  /** Best corpus frequency rank among the word's forms (1 = most frequent), or null. */
  freqRank: number | null;
  cognate: boolean;
  /** Mean share of other words in its sentences the learner already met (0–1). */
  comprehensible: number;
  rareTokens: string[];
}

const RARE_RANK = 10_000;
const FREE_TOP = 100;

/** The OpenSubtitles frequency list (hermitdave/FrequencyWords): "form count" lines, most frequent first. */
export const frequencyListUrl = (lang: string) => `https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/${lang}/${lang}_50k.txt`;

/** Corpus frequency ranks (form → 1-based rank), cached under scripts/.cache. */
export async function frequencyRanks(lang: string): Promise<Map<string, number>> {
  const dir = join(ROOT, "scripts", ".cache");
  const path = join(dir, `${lang}_50k.txt`);
  if (!existsSync(path)) {
    const res = await fetch(frequencyListUrl(lang));
    if (!res.ok) throw new Error(`frequency list for ${lang}: HTTP ${res.status}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, await res.text());
  }
  const ranks = new Map<string, number>();
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, i) => {
      const form = formKey(line.slice(0, line.lastIndexOf(" ")));
      if (form && !ranks.has(form)) ranks.set(form, i + 1);
    });
  return ranks;
}

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const strip = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Looks like its English gloss: "hospital"/"hospital", "familia"/"family", "Haus"/"house". */
export function isCognate(lemma: string, gloss: string): boolean {
  const a = strip(lemma);
  return gloss
    .split(/[;,/()]/)
    .map((g) => strip(g.replace(/^(to|a|an|the)\s+/i, "").trim()))
    .filter((g) => g.length >= 4 && a.length >= 4)
    .some((g) => levenshtein(a, g) / Math.max(a.length, g.length) <= 0.34);
}

export function auditDeck(lang: string, deck: Deck, ranks: Map<string, number>, allowForms: Set<string> = new Set()): { findings: Finding[]; words: WordStats[] } {
  const findings: Finding[] = [];
  const live = deck.words.filter((w) => !w.retired && !w.aliasOf).sort((a, b) => a.rank - b.rank);
  const sentences = deck.sentences.filter((s) => !s.retired);
  const byWord = new Map<string, DeckSentence[]>();
  for (const s of sentences) byWord.set(s.wordId, [...(byWord.get(s.wordId) ?? []), s]);

  // Duplicate sentences anywhere.
  const seen = new Map<string, DeckWord>();
  const wordOf = new Map(live.map((w) => [w.id, w]));
  for (const s of sentences) {
    const k = formKey(s.text).replace(/[^\p{L}\p{N} ]/gu, "");
    const w = wordOf.get(s.wordId);
    const prev = seen.get(k);
    if (prev && w)
      findings.push(
        prev.id === w.id
          ? { level: "error", code: "duplicate-sentence", lemma: w.lemma, message: `"${s.text}" appears twice for this word` }
          : { level: "warn", code: "shared-sentence", lemma: w.lemma, message: `"${s.text}" is also a sentence of "${prev.lemma}": learners will see it twice` },
      );
    else if (w) seen.set(k, w);
  }

  // Same lemma twice, lemma as another word's form, forms under two words.
  const byLemma = new Map<string, DeckWord[]>();
  const byForm = new Map<string, DeckWord[]>();
  for (const w of live) {
    byLemma.set(formKey(w.lemma), [...(byLemma.get(formKey(w.lemma)) ?? []), w]);
    for (const f of new Set(w.forms.map(formKey))) byForm.set(f, [...(byForm.get(f) ?? []), w]);
  }
  for (const [lemma, ws] of byLemma) {
    if (ws.length < 2) continue;
    const samePos = ws.some((a, i) => ws.some((b, j) => j > i && a.pos === b.pos && (a.sense ?? "") === (b.sense ?? "")));
    findings.push({ level: samePos ? "error" : "warn", code: "same-lemma", lemma, message: `"${lemma}" appears ${ws.length} times (${ws.map((w) => w.pos).join(", ")})${samePos ? " with the same part of speech" : ": fine if the senses really differ"}` });
  }
  for (const w of live) {
    const others = (byForm.get(formKey(w.lemma)) ?? []).filter((o) => o.id !== w.id && formKey(o.lemma) !== formKey(w.lemma));
    if (others.length && !allowForms.has(formKey(w.lemma))) findings.push({ level: "warn", code: "lemma-is-form", lemma: w.lemma, message: `"${w.lemma}" is also listed as a form of ${others.map((o) => `"${o.lemma}"`).join(", ")}: a duplicate?` });
  }
  for (const [form, ws] of byForm) {
    const lemmas = new Set(ws.map((w) => formKey(w.lemma)));
    if (lemmas.size > 1 && !allowForms.has(form)) findings.push({ level: "warn", code: "shared-form", lemma: form, message: `the form "${form}" belongs to ${[...lemmas].map((l) => `"${l}"`).join(" and ")}; allow it in audit-allow.json if that is right` });
  }

  // Ease and order.
  const course = courseOrder({ words: live });
  const metAt = new Map(course.map((w, i) => [w.id, i])); // word → its place in the course
  const metBy = new Map<string, number>(); // form → place of the first word that introduces it
  course.forEach((w, i) => {
    for (const f of w.forms) if (!metBy.has(formKey(f))) metBy.set(formKey(f), i);
  });
  const words: WordStats[] = live.map((w) => {
    const freqRank = Math.min(...w.forms.map((f) => ranks.get(formKey(f)) ?? Infinity));
    const rare = new Set<string>();
    let compSum = 0;
    const list = byWord.get(w.id) ?? [];
    for (const s of list) {
      const toks = tokenize(s.text, language(lang).tag)
        // Names (capitalised mid-sentence; German nouns excepted) are free.
        .filter((t) => t.word && !/^\d+$/.test(t.text) && !(lang !== "de" && t.index > 0 && /^\p{Lu}/u.test(t.text)))
        .map((t) => formKey(t.text))
        .filter((t) => t !== formKey(s.cloze));
      let known = 0;
      for (const t of toks) {
        const r = ranks.get(t);
        if (r === undefined || r > RARE_RANK) rare.add(t);
        if ((metBy.get(t) ?? Infinity) < metAt.get(w.id)! || (r !== undefined && r <= FREE_TOP)) known++;
      }
      compSum += toks.length ? known / toks.length : 1;
    }
    return { rank: w.rank, id: w.id, lemma: w.lemma, pos: w.pos, freqRank: Number.isFinite(freqRank) ? freqRank : null, cognate: isCognate(w.lemma, w.gloss), comprehensible: list.length ? compSum / list.length : 0, rareTokens: [...rare] };
  });
  const placed = new Set(live.filter((w) => w.garden).map((w) => w.id));
  for (const s of words) {
    if (s.rareTokens.length) findings.push({ level: "warn", code: "rare-word", lemma: s.lemma, message: `sentences use words outside the top ${RARE_RANK}: ${s.rareTokens.slice(0, 6).join(", ")}` });
    if (s.freqRank === null) findings.push({ level: "warn", code: "not-in-corpus", lemma: s.lemma, message: `none of its forms is in the frequency list: is it common?` });
    else if (!placed.has(s.id) && s.freqRank > Math.max(500, s.rank * 4)) findings.push({ level: "warn", code: "rank-drift", lemma: s.lemma, message: `deck rank ${s.rank} but corpus rank ${s.freqRank}: introduced too early?` });
  }
  return { findings, words };
}

/** Findings by lowercased lemma, as "code: message" lines for the proofreader. */
export function findingsByLemma(findings: Finding[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const f of findings) if (f.lemma) map.set(f.lemma.toLowerCase(), [...(map.get(f.lemma.toLowerCase()) ?? []), `${f.code}: ${f.message}`]);
  return map;
}

export function loadAllow(lang: string): Set<string> {
  const p = join(deckDir(lang), "audit-allow.json");
  if (!existsSync(p)) return new Set();
  return new Set(((JSON.parse(readFileSync(p, "utf8")) as { forms?: string[] }).forms ?? []).map(formKey));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const langs = args.filter((a) => !a.startsWith("--"));
  let errors = 0;
  const out: Record<string, unknown> = {};
  for (const lang of langs.length ? langs : DECK_LANGS) {
    const path = join(deckDir(lang), "deck.json");
    if (!existsSync(path)) continue;
    const deck = Deck(lang).parse(JSON.parse(readFileSync(path, "utf8")));
    const { findings, words } = auditDeck(lang, deck, await frequencyRanks(lang), loadAllow(lang));
    errors += findings.filter((f) => f.level === "error").length;
    if (json) {
      out[lang] = { findings, words };
      continue;
    }
    const comp = words.reduce((s, w) => s + w.comprehensible, 0) / Math.max(1, words.length);
    console.log(`\n${lang}: ${words.length} words; mean comprehensibility ${(comp * 100).toFixed(0)}%; cognates ${words.filter((w) => w.cognate).length}`);
    for (const f of findings) console.log(`  ${f.level === "error" ? "✗" : "!"} [${f.code}] ${f.lemma ?? ""}: ${f.message}`);
  }
  if (json) console.log(JSON.stringify(out, null, 2));
  process.exit(errors ? 1 : 0);
}
