// Methodical proofreading: one entry at a time, a recorded verdict for every
// entry, tied to a hash of that entry's exact content. Approval (review.ts)
// and CI require every entry in the file to be marked "ok" as it is now, so
// "the proofreader looked at every word" is something we can check.
//
//   bun scripts/deck/proof.ts next   <lang> <NNNN>                 # the next entry to judge, and progress
//   bun scripts/deck/proof.ts mark   <lang> <NNNN> <lemma[|pos[|sense]]> ok --reviewer <name>
//   bun scripts/deck/proof.ts mark   <lang> <NNNN> <lemma[|pos[|sense]]> fix --reviewer <name> --note "s2: …; gloss: …"
//   bun scripts/deck/proof.ts status <lang> <NNNN>                 # counts, and every open fix (the editor's to-do)
//
// An entry needs judging when it has no verdict, or its content changed since
// the verdict (so after a fix, only the fixed entries come back).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { Deck, manifestKey, SourceWord } from "../../web/src/deck/schema.ts";
import { auditDeck, frequencyRanks, loadAllow } from "./audit.ts";
import { locate } from "../../web/src/content/text.ts";
import { deckDir, wholeWordCount } from "./lib.ts";

export const Ledger = z.object({
  file: z.string(),
  reviewer: z.string(),
  entries: z.record(z.string(), z.object({ hash: z.string(), verdict: z.enum(["ok", "fix"]), note: z.string().optional(), at: z.string() })),
});
export type Ledger = z.infer<typeof Ledger>;

export const entryHash = (w: SourceWord) => createHash("sha256").update(JSON.stringify(w)).digest("hex").slice(0, 16);
export const ledgerPath = (lang: string, num: string) => join(deckDir(lang), "reviews", `${num}.ledger.json`);
export const sourcePath = (lang: string, num: string) => join(deckDir(lang), "source", `${num}.json`);

export function readEntries(lang: string, num: string): SourceWord[] {
  return SourceWord.array().parse(JSON.parse(readFileSync(sourcePath(lang, num), "utf8")));
}

export function readLedger(lang: string, num: string): Ledger | null {
  const p = ledgerPath(lang, num);
  return existsSync(p) ? Ledger.parse(JSON.parse(readFileSync(p, "utf8"))) : null;
}

/** Each entry's state against the ledger. */
export function ledgerState(entries: SourceWord[], ledger: Ledger | null) {
  return entries.map((w) => {
    const key = manifestKey(w);
    const rec = ledger?.entries[key];
    const hash = entryHash(w);
    const state = !rec ? "unjudged" : rec.hash !== hash ? (rec.verdict === "fix" ? "fixed: re-check" : "changed: re-check") : rec.verdict === "ok" ? "ok" : "awaiting fix";
    return { w, key, hash, rec, state };
  });
}

/** Problems that block approval: anything not "ok" as it is now. */
export function ledgerProblems(lang: string, num: string): string[] {
  const states = ledgerState(readEntries(lang, num), readLedger(lang, num));
  const open = states.filter((s) => s.state !== "ok");
  return open.length ? [`decks/${lang}/source/${num}.json: ${open.length} of ${states.length} entries not marked ok by the proofreader (${[...new Set(open.map((o) => o.state))].join(", ")}); see scripts/deck/proof.ts`] : [];
}

function card(lang: string, num: string, s: ReturnType<typeof ledgerState>[number], flags: string[], index: number, total: number): string {
  const w = s.w;
  const lines = [
    `Entry ${index + 1} of ${total} in decks/${lang}/source/${num}.json — state: ${s.state}`,
    s.rec?.note ? `Previous note: ${s.rec.note}` : "",
    "",
    `${w.lemma}${w.sense ? ` (${w.sense})` : ""} — ${w.pos}${w.gender ? `, ${w.gender}` : ""}`,
    `gloss: ${w.gloss}`,
    `forms: ${w.forms.join(", ")}`,
    w.notes ? `notes: ${w.notes}` : "",
    "",
    ...w.sentences.map((x, i) => {
      const n = x.text.split(/\s+/).filter(Boolean).length;
      const auto = [n > 12 ? `${n} words` : "", wholeWordCount(x.text, x.cloze) !== 1 ? "cloze not exactly once" : "", w.forms.some((f) => f.toLowerCase() === x.cloze.toLowerCase()) ? "" : "cloze not in forms"].filter(Boolean);
      return `s${i + 1}. ${bracket(x.text, x.cloze)}\n    → ${x.translation}${auto.length ? `\n    ⚠ ${auto.join("; ")}` : ""}`;
    }),
    ...(flags.length ? ["", ...flags.map((f) => `⚑ ${f}`)] : []),
    "",
    `Judge every line against docs/decks.md, then:`,
    `  bun scripts/deck/proof.ts mark ${lang} ${num} "${s.key.split("|").filter(Boolean).join("|")}" ok --reviewer <you>`,
    `  bun scripts/deck/proof.ts mark ${lang} ${num} "${s.key.split("|").filter(Boolean).join("|")}" fix --reviewer <you> --note "s2: …"`,
  ];
  return lines.filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

async function flagsFor(lang: string): Promise<Map<string, string[]>> {
  const deckPath = join(deckDir(lang), "deck.json");
  const map = new Map<string, string[]>();
  if (!existsSync(deckPath)) return map;
  const deck = Deck(lang).parse(JSON.parse(readFileSync(deckPath, "utf8")));
  const { findings } = auditDeck(lang, deck, await frequencyRanks(lang), loadAllow(lang));
  for (const f of findings) if (f.lemma) map.set(f.lemma.toLowerCase(), [...(map.get(f.lemma.toLowerCase()) ?? []), `${f.code}: ${f.message}`]);
  return map;
}

if (import.meta.main) {
  const [cmd, lang, num, ...rest] = process.argv.slice(2);
  const flag = (name: string) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  if (!cmd || !lang || !num) {
    console.error("usage: proof.ts next|mark|status <lang> <NNNN> …");
    process.exit(2);
  }
  const entries = readEntries(lang, num);
  const ledger = readLedger(lang, num);
  const states = ledgerState(entries, ledger);

  if (cmd === "next") {
    const i = states.findIndex((s) => s.state !== "ok" && s.state !== "awaiting fix");
    const done = states.filter((s) => s.state === "ok").length;
    if (i < 0) {
      const waiting = states.filter((s) => s.state === "awaiting fix").length;
      console.log(waiting ? `Every entry judged: ${done} ok, ${waiting} awaiting a fix by the editor (proof.ts status shows them).` : `ALL ${done} ENTRIES OK — ready for review.ts approval.`);
      process.exit(0);
    }
    const flags = (await flagsFor(lang)).get(states[i].w.lemma.toLowerCase()) ?? [];
    console.log(card(lang, num, states[i], flags, i, states.length));
    console.log(`\nProgress: ${done}/${states.length} ok.`);
  } else if (cmd === "mark") {
    const [target, verdict] = rest;
    const reviewer = flag("reviewer");
    if (!target || (verdict !== "ok" && verdict !== "fix") || !reviewer) {
      console.error('usage: proof.ts mark <lang> <NNNN> <lemma[|pos[|sense]]> ok|fix --reviewer <name> [--note "…"]');
      process.exit(2);
    }
    if (verdict === "fix" && !flag("note")) {
      console.error("a fix needs --note saying exactly what to change");
      process.exit(2);
    }
    const parts = target.split("|");
    const matches = states.filter((s) => s.w.lemma === parts[0] && (!parts[1] || s.w.pos === parts[1]) && (!parts[2] || (s.w.sense ?? "") === parts[2]));
    if (matches.length !== 1) {
      console.error(matches.length ? `"${target}" matches ${matches.length} entries; add |pos or |pos|sense` : `no entry "${target}" in this file`);
      process.exit(2);
    }
    if (ledger && ledger.reviewer !== reviewer) {
      console.error(`this file's ledger belongs to ${ledger.reviewer}; one proofreader per file`);
      process.exit(2);
    }
    const next: Ledger = ledger ?? { file: `source/${num}.json`, reviewer, entries: {} };
    const m = matches[0];
    next.entries[m.key] = { hash: m.hash, verdict, ...(flag("note") ? { note: flag("note") } : {}), at: new Date().toISOString() };
    mkdirSync(join(deckDir(lang), "reviews"), { recursive: true });
    writeFileSync(ledgerPath(lang, num), `${JSON.stringify(next, null, 2)}\n`);
    const done = ledgerState(entries, next).filter((s) => s.state === "ok").length;
    console.log(`${m.w.lemma}: ${verdict}. Progress: ${done}/${entries.length} ok.`);
  } else if (cmd === "status") {
    const by = new Map<string, number>();
    for (const s of states) by.set(s.state, (by.get(s.state) ?? 0) + 1);
    console.log(`decks/${lang}/source/${num}.json — ${[...by].map(([k, v]) => `${v} ${k}`).join(", ")}${ledger ? ` (proofreader: ${ledger.reviewer})` : ""}`);
    for (const s of states.filter((x) => x.state === "awaiting fix")) console.log(`  FIX ${s.w.lemma} (${s.w.pos}): ${s.rec?.note}`);
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
}

/** The sentence with its cloze in [brackets], at the whole-word match the app uses. */
function bracket(text: string, cloze: string) {
  const i = locate(text, cloze);
  return i < 0 ? text : `${text.slice(0, i)}[${cloze}]${text.slice(i + cloze.length)}`;
}
