// The garden fuzzer's command (#1025). From web/:
//
//   bun run fuzz:garden                     500 gardens from seed 1
//   bun run fuzz:garden --cases 2000 --from 9000
//   bun run fuzz:garden --case s7-p120-door-open    one garden, every finding
//
// It prints each broken rule once, shrunk to the smallest garden that still
// breaks it, with the command that repeats it. Exit 1 on any finding.

import { parseArgs } from "node:util";

import { caseName, caseOf, check, knownIn, parseCase, RULES, shrink, type Effort, type Finding, type Rule } from "./garden";

const { values } = parseArgs({ options: { cases: { type: "string", default: "500" }, from: { type: "string", default: "1" }, case: { type: "string" } } });
const effort: Effort = { frames: 3000, plantWalks: 6 };
const started = performance.now();

const cases = values.case ? [parseCase(values.case)] : Array.from({ length: Number(values.cases) }, (_, i) => caseOf(Number(values.from) + i));
const first = new Map<Rule, Finding>();
const counts = new Map<Rule, number>();
const known = new Set<string>();
for (const c of cases) {
  const found = check(c, effort);
  for (const f of found) {
    // None yet: this is the rule's first.
    counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
    if (!first.has(f.rule)) first.set(f.rule, f);
    // One garden asked for: every finding in it.
    if (values.case) console.log(`${f.rule}: ${f.what}`);
  }
  for (const k of knownIn(c)) known.add(k);
}

for (const [rule, f] of first) {
  const small = values.case ? f.c : shrink(f.c, rule, effort);
  // check is the same every time: the garden shrink kept breaks the rule again.
  const again = check(small, effort).find((g) => g.rule === rule)!;
  console.log(`\n${rule} (${counts.get(rule)} in ${cases.length} gardens): ${RULES[rule]}`);
  console.log(`  ${again.what}`);
  console.log(`  garden: ${small.plants} plants, door ${small.door ? "open" : "shut"}, back way ${small.back}, seed ${small.seed}${again.at ? `, at (${again.at[0].toFixed(2)}, ${again.at[1].toFixed(2)})` : ""}`);
  console.log(`  again:  cd web && bun run fuzz:garden --case ${caseName(small)}`);
}
console.log(`\n${cases.length} gardens in ${((performance.now() - started) / 1000).toFixed(1)} s: ${first.size ? `${[...counts.values()].reduce((a, b) => a + b, 0)} findings` : "no findings"}.`);
if (known.size) console.log(`Drawn but not solid yet (garden.ts KNOWN): ${[...known].join(", ")}.`);
process.exit(first.size ? 1 : 0);
