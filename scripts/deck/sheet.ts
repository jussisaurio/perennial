// A proofreading sheet for one source file: every word with its sentences,
// the target word in bold, and the automatic flags next to each line, so the
// proofreader reads a page, not JSON, and spends attention on meaning.
//
//   bun scripts/deck/sheet.ts <lang> <NNNN> [--only-flagged] > sheet.md

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Deck, manifestKey, SourceWord } from "../../web/src/deck/schema.ts";
import { auditDeck, frequencyRanks, loadAllow } from "./audit.ts";
import { deckDir, wholeWordCount } from "./lib.ts";

const [lang, num, ...rest] = process.argv.slice(2);
if (!lang || !num) {
  console.error("usage: bun scripts/deck/sheet.ts <lang> <NNNN> [--only-flagged]");
  process.exit(2);
}
const onlyFlagged = rest.includes("--only-flagged");
const source = SourceWord.array().parse(JSON.parse(readFileSync(join(deckDir(lang), "source", `${num}.json`), "utf8")));
const deck = Deck(lang).parse(JSON.parse(readFileSync(join(deckDir(lang), "deck.json"), "utf8")));
const ranks = await frequencyRanks(lang);
const { findings, words } = auditDeck(lang, deck, ranks, loadAllow(lang));
const statsBy = new Map(words.map((w) => [manifestKey(w as never) + "", w]));
const deckBy = new Map(deck.words.filter((w) => !w.retired).map((w) => [manifestKey(w), w]));
const findingsBy = new Map<string, string[]>();
for (const f of findings) if (f.lemma) findingsBy.set(f.lemma.toLowerCase(), [...(findingsBy.get(f.lemma.toLowerCase()) ?? []), `${f.code}: ${f.message}`]);

const out: string[] = [`# Proofreading sheet: decks/${lang}/source/${num}.json`, "", `${source.length} words. Checklist: docs/decks.md. Flags are hints, not verdicts.`, ""];
for (const w of source) {
  const dw = deckBy.get(manifestKey(w));
  const st = dw ? words.find((x) => x.id === dw.id) : undefined;
  const flags = [...(findingsBy.get(w.lemma.toLowerCase()) ?? [])];
  const lines: string[] = [];
  for (const s of w.sentences) {
    const n = s.text.split(/\s+/).filter(Boolean).length;
    const marks: string[] = [];
    if (n > 12) marks.push(`${n} words`);
    const c = wholeWordCount(s.text, s.cloze);
    if (c !== 1) marks.push(c === 0 ? "cloze not found as a whole word" : `cloze appears ${c}×`);
    if (!w.forms.some((f) => f.toLowerCase() === s.cloze.toLowerCase())) marks.push(`cloze "${s.cloze}" not in forms`);
    const bold = s.text.replace(s.cloze, `**${s.cloze}**`);
    lines.push(`- ${bold} — _${s.translation}_${marks.length ? `  ⚠ ${marks.join("; ")}` : ""}`);
  }
  const flagged = flags.length > 0 || lines.some((l) => l.includes("⚠"));
  if (onlyFlagged && !flagged) continue;
  const meta = [w.pos, w.gender ? `gender ${w.gender}` : "", st ? `deck rank ${st.rank}` : "", st?.freqRank ? `corpus rank ${st.freqRank}` : "corpus: not found", st?.cognate ? "cognate" : "", st ? `comprehensible ${(st.comprehensible * 100).toFixed(0)}%` : ""].filter(Boolean);
  out.push(`## ${w.lemma}${w.sense ? ` (${w.sense})` : ""} — ${w.gloss}`, "", `${meta.join(" · ")}  `, `forms: ${w.forms.join(", ")}${w.notes ? `  \nnotes: ${w.notes}` : ""}`, "", ...lines, "");
  if (flags.length) out.push(...flags.map((f) => `> ⚑ ${f}`), "");
}
void statsBy;
console.log(out.join("\n"));
