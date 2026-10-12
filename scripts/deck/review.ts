// Record a proofreader's approval of one deck source file.
//   bun scripts/deck/review.ts <lang> <NNNN> --author <who wrote it> --reviewer <who proofread it> [--notes "…"]
// The record pins the file's exact content (sha256): editing the file later
// invalidates the approval, and `check.ts` fails until it is reviewed again.
// The author and the reviewer must be different (people or agents).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deckDir, flagValue, sourcePath, toJson } from "./lib.ts";
import { reviewPath, samePerson, sha256File } from "./reviews.ts";
import { ledgerProblems, readLedger } from "./proof.ts";

const [lang, num, ...rest] = process.argv.slice(2);
const flag = (name: string) => flagValue(rest, name);
const author = flag("author");
const reviewer = flag("reviewer");
if (!lang || !num || !author || !reviewer) {
  console.error('usage: bun scripts/deck/review.ts <lang> <NNNN> --author <who> --reviewer <who> [--notes "…"]');
  process.exit(2);
}
if (samePerson(author, reviewer)) {
  console.error("the author and the reviewer must be different");
  process.exit(2);
}
const ledger = readLedger(lang, num);
if (!ledger || !samePerson(ledger.reviewer, reviewer)) {
  console.error(`no proofreading ledger by ${reviewer} for this file: use scripts/deck/proof.ts first`);
  process.exit(2);
}
const open = ledgerProblems(lang, num);
if (open.length) {
  console.error(open.join("\n"));
  process.exit(2);
}
const record = { file: `source/${num}.json`, sha256: sha256File(sourcePath(lang, num)), author, reviewer, reviewedAt: new Date().toISOString().slice(0, 10), verdict: "approved", notes: flag("notes") ?? "" };
mkdirSync(join(deckDir(lang), "reviews"), { recursive: true });
writeFileSync(reviewPath(lang, num), toJson(record));
console.log(`approved decks/${lang}/source/${num}.json (reviewer: ${reviewer})`);
