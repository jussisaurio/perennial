import { expect, test } from "bun:test";
import { caseName, caseOf, check } from "./garden";

// A small fixed slice of `bun run fuzz:garden` (#1025): the same gardens every
// run, a short walk in each. A finding prints its case; the full run there
// shrinks it and has more seeds.

test("the garden fuzzer finds nothing in its fixed gardens", () => {
  const found: string[] = [];
  for (let seed = 1; seed <= 16; seed++) {
    const c = caseOf(seed);
    for (const f of check(c, { frames: 600, plantWalks: 2 })) found.push(`${f.rule} in ${caseName(c)}: ${f.what}`);
  }
  expect(found).toEqual([]);
});
