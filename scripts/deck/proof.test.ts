import { expect, test } from "bun:test";
import type { SourceWord } from "../../web/src/deck/schema.ts";
import { entryHash, ledgerState, type Ledger } from "./proof.ts";
import { isCognate } from "./audit.ts";

const word = (lemma: string, text = `Hola ${lemma}.`): SourceWord => ({
  lemma,
  gloss: "x",
  pos: "noun",
  forms: [lemma],
  sentences: [1, 2, 3].map((i) => ({ text: `${text} ${i}`, translation: "t", cloze: lemma })),
});

test("the ledger tracks a verdict per entry, and edits bring an entry back", () => {
  const a = word("casa");
  const b = word("perro");
  const ledger: Ledger = { file: "source/0001.json", reviewer: "r", entries: {} };
  expect(ledgerState([a, b], ledger).map((s) => s.state)).toEqual(["unjudged", "unjudged"]);
  ledger.entries["casa|noun|"] = { hash: entryHash(a), verdict: "ok", at: "" };
  ledger.entries["perro|noun|"] = { hash: entryHash(b), verdict: "fix", note: "s1: …", at: "" };
  expect(ledgerState([a, b], ledger).map((s) => s.state)).toEqual(["ok", "awaiting fix"]);
  // The editor fixes perro; a later edit to casa also needs a new look.
  const b2 = word("perro", "Mi perro");
  const a2 = word("casa", "Mi casa");
  expect(ledgerState([a2, b2], ledger).map((s) => s.state)).toEqual(["changed: re-check", "fixed: re-check"]);
});

test("cognates look like their English gloss", () => {
  expect(isCognate("familia", "family")).toBe(true);
  expect(isCognate("hospital", "hospital")).toBe(true);
  expect(isCognate("perro", "dog")).toBe(false);
});
