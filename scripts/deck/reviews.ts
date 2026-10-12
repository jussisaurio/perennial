// Review records: decks/<lang>/reviews/<NNNN>.json, one per source file.

import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { z } from "zod";
import { deckDir, sourceFiles } from "./lib.ts";
import { ledgerProblems, readLedger } from "./proof.ts";

const Review = z.object({
  file: z.string(),
  sha256: z.string().length(64),
  author: z.string().min(1),
  reviewer: z.string().min(1),
  reviewedAt: z.string(),
  verdict: z.literal("approved"),
  notes: z.string().optional(),
});

export const sha256File = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
export const reviewPath = (lang: string, num: string) => join(deckDir(lang), "reviews", `${num}.json`);
/** Author and reviewer names compare without case or surrounding spaces. */
export const samePerson = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Problems with the reviews of a language's source files (empty when every file is approved as it is). */
export function reviewProblems(lang: string): string[] {
  const out: string[] = [];
  for (const file of sourceFiles(lang)) {
    const f = basename(file);
    const num = f.slice(0, 4);
    const path = reviewPath(lang, num);
    const where = `decks/${lang}/source/${f}`;
    if (!existsSync(path)) {
      out.push(`${where} has no proofreader approval (decks/${lang}/reviews/${num}.json): see docs/decks.md`);
      continue;
    }
    const r = Review.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!r.success) out.push(`decks/${lang}/reviews/${num}.json is not a valid review record`);
    else if (r.data.sha256 !== sha256File(file)) out.push(`${where} changed after it was approved: it needs a new review`);
    else if (samePerson(r.data.author, r.data.reviewer)) out.push(`${where} was approved by its own author`);
    else {
      // The approval must rest on a complete, per-entry ledger by the same proofreader.
      const ledger = readLedger(lang, num);
      if (!ledger) out.push(`${where} has an approval but no proofreading ledger (decks/${lang}/reviews/${num}.ledger.json)`);
      else if (!samePerson(ledger.reviewer, r.data.reviewer)) out.push(`${where}: the ledger's proofreader is not the approver`);
      else out.push(...ledgerProblems(lang, num));
    }
  }
  return out;
}
