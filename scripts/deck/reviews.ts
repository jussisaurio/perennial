// Review records: decks/<lang>/reviews/<NNNN>.json, one per source file.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { deckDir } from "./lib.ts";

export const Review = z.object({
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

/** Problems with the reviews of a language's source files (empty when every file is approved as it is). */
export function reviewProblems(lang: string): string[] {
  const dir = join(deckDir(lang), "source");
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const f of readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f)).sort()) {
    const num = f.slice(0, 4);
    const path = reviewPath(lang, num);
    const where = `decks/${lang}/source/${f}`;
    if (!existsSync(path)) {
      out.push(`${where} has no proofreader approval (decks/${lang}/reviews/${num}.json): see docs/decks.md`);
      continue;
    }
    const r = Review.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!r.success) out.push(`decks/${lang}/reviews/${num}.json is not a valid review record`);
    else if (r.data.sha256 !== sha256File(join(dir, f))) out.push(`${where} changed after it was approved: it needs a new review`);
    else if (r.data.author.trim().toLowerCase() === r.data.reviewer.trim().toLowerCase()) out.push(`${where} was approved by its own author`);
  }
  return out;
}
