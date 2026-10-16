import { expect, test } from "bun:test";
import { syncedUserWord } from "./rows";

const row = { id: "w1", lemma: "zorro" };

test("user_word forms: a list, or a string holding the list's JSON (#337), both come out as the list", () => {
  const bad: string[] = [];
  const report = (type: string) => void bad.push(type);
  expect(syncedUserWord({ ...row, forms: ["zorro", "zorros"] }, report).forms).toEqual(["zorro", "zorros"]);
  expect(syncedUserWord({ ...row, forms: '["zorro","zorros"]' }, report).forms).toEqual(["zorro", "zorros"]);
  expect(syncedUserWord({ ...row, forms: "[]" }, report).forms).toEqual([]);
  expect(bad).toEqual([]);
});

test("user_word forms of any other shape: no forms, and the type is reported, never the value", () => {
  const bad: string[] = [];
  const report = (type: string) => void bad.push(type);
  expect(syncedUserWord({ ...row, forms: "zorro" }, report).forms).toEqual([]);
  expect(syncedUserWord({ ...row, forms: '"zorro"' }, report).forms).toEqual([]);
  expect(syncedUserWord({ ...row, forms: [1, 2] }, report).forms).toEqual([]);
  expect(syncedUserWord({ ...row, forms: null }, report).forms).toEqual([]);
  expect(bad).toEqual(["string", "string", "object", "object"]);
});

test("an update without forms keeps the columns it has", () => {
  const update = { id: "w1", gloss: "fox" };
  expect(syncedUserWord(update, () => {})).toEqual(update);
});
