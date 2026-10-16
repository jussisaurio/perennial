// The deck word ids are read when the server starts: a course without a
// readable deck stops it there, saying which file, not at the first write.

import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cause, Effect, Exit, Layer } from "effect";
import { AppConfig, loadConfig } from "../src/config";
import { Words, WordsLive } from "../src/words";

const load = (decksDir: string) =>
  Effect.runPromiseExit(Effect.flatMap(Words, (w) => Effect.succeed(w.isDeckWord("es.w.x", "es"))).pipe(Effect.provide(WordsLive.pipe(Layer.provide(Layer.succeed(AppConfig, loadConfig({ decksDir })))))));

const failure = (exit: Exit.Exit<unknown, unknown>) => (Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : "started");

test("a course with no deck.json stops the start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "decks-"));
  mkdirSync(join(dir, "es"));
  writeFileSync(join(dir, "es", "deck.json"), JSON.stringify({ words: [{ id: "es.w.x" }] }));
  expect(failure(await load(dir))).toContain(join(dir, "de", "deck.json"));
});

test("a deck.json that is not a deck stops the start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "decks-"));
  for (const lang of ["es", "de"]) {
    mkdirSync(join(dir, lang));
    writeFileSync(join(dir, lang, "deck.json"), lang === "de" ? JSON.stringify({ words: [{ lemma: "no id" }] }) : JSON.stringify({ words: [{ id: "es.w.x" }] }));
  }
  expect(failure(await load(dir))).toContain(join(dir, "de", "deck.json"));
});

test("the real decks load", async () => {
  const exit = await load(loadConfig().decksDir);
  expect(Exit.isSuccess(exit)).toBe(true);
});
