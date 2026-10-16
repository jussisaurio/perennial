// A proofreading sheet for one source file: every word with its sentences,
// the target word in bold, and the automatic flags next to each line, so the
// proofreader reads a page, not JSON, and spends attention on meaning.
//
//   bun scripts/deck/sheet.ts <lang> <NNNN> [--only-flagged] > sheet.md

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import { Deck, manifestKey } from "../../web/src/deck/schema.ts";
import { auditDeck, findingsByLemma, frequencyRanks, loadAllow } from "./audit.ts";
import { readEntries } from "./proof.ts";
import { deckDir, markCloze, sentenceFlags } from "./lib.ts";

const [lang, num, ...rest] = process.argv.slice(2);
if (!lang || !num) {
  console.error("usage: bun scripts/deck/sheet.ts <lang> <NNNN> [--only-flagged]");
  process.exit(2);
}
const onlyFlagged = rest.includes("--only-flagged");
const source = readEntries(lang, num);
const deck = Schema.decodeUnknownSync(Deck(lang))(JSON.parse(readFileSync(join(deckDir(lang), "deck.json"), "utf8")));
const ranks = await frequencyRanks(lang);
const { findings, words } = auditDeck(lang, deck, ranks, loadAllow(lang));
const deckBy = new Map(deck.words.filter((w) => !w.retired).map((w) => [manifestKey(w), w]));
const findingsBy = findingsByLemma(findings);

const out: string[] = [`# Proofreading sheet: decks/${lang}/source/${num}.json`, "", `${source.length} words. Checklist: docs/decks.md. Flags are hints, not verdicts.`, ""];
for (const w of source) {
  const dw = deckBy.get(manifestKey(w));
  const st = dw ? words.find((x) => x.id === dw.id) : undefined;
  const flags = [...(findingsBy.get(w.lemma.toLowerCase()) ?? [])];
  const lines: string[] = [];
  for (const s of w.sentences) {
    const marks = sentenceFlags(s, w.forms);
    lines.push(`- ${markCloze(s.text, s.cloze, "**", "**")} — _${s.translation}_${marks.length ? `  ⚠ ${marks.join("; ")}` : ""}`);
  }
  const flagged = flags.length > 0 || lines.some((l) => l.includes("⚠"));
  if (onlyFlagged && !flagged) continue;
  const meta = [w.pos, w.gender ? `gender ${w.gender}` : "", st ? `deck rank ${st.rank}` : "", st?.freqRank ? `corpus rank ${st.freqRank}` : "corpus: not found", st?.cognate ? "cognate" : "", st ? `comprehensible ${(st.comprehensible * 100).toFixed(0)}%` : ""].filter(Boolean);
  out.push(`## ${w.lemma}${w.sense ? ` (${w.sense})` : ""} — ${w.gloss}`, "", `${meta.join(" · ")}  `, `forms: ${w.forms.join(", ")}${w.notes ? `  \nnotes: ${w.notes}` : ""}`, "", ...lines, "");
  if (flags.length) out.push(...flags.map((f) => `> ⚑ ${f}`), "");
}
console.log(out.join("\n"));
