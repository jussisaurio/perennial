import { expect, test } from "bun:test";
import { syncedUserWord } from "./rows";

/** A row as the server sent it: its forms can be of any shape. */
const row = (forms: unknown) => ({ id: "w1", lemma: "zorro", forms });

test("user_word forms: a list, or a string holding the list's JSON (#337), both come out as the list", () => {
  const bad: string[] = [];
  const report = (type: string) => void bad.push(type);
  expect(syncedUserWord(row(["zorro", "zorros"]), report).forms).toEqual(["zorro", "zorros"]);
  expect(syncedUserWord(row('["zorro","zorros"]'), report).forms).toEqual(["zorro", "zorros"]);
  expect(syncedUserWord(row("[]"), report).forms).toEqual([]);
  expect(bad).toEqual([]);
});

test("user_word forms of any other shape: no forms, and the type is reported, never the value", () => {
  const bad: string[] = [];
  const report = (type: string) => void bad.push(type);
  expect(syncedUserWord(row("zorro"), report).forms).toEqual([]);
  expect(syncedUserWord(row('"zorro"'), report).forms).toEqual([]);
  expect(syncedUserWord(row([1, 2]), report).forms).toEqual([]);
  expect(syncedUserWord(row(null), report).forms).toEqual([]);
  expect(bad).toEqual(["string", "string", "object", "object"]);
});
