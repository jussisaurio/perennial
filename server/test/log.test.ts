// LOG_LEVEL (docs/DEPLOY.md): debug, info, warn, error or silent. A line below
// the level is not written, from Effect code or from Promise code (#329).

import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { log, LoggerLive } from "../src/log";

const saved = { log: console.log, error: console.error, level: process.env.LOG_LEVEL };
afterEach(() => {
  console.log = saved.log;
  console.error = saved.error;
  process.env.LOG_LEVEL = saved.level;
});

/** The level of each line written while `level` is set, by both kinds of code. */
async function written(level: string) {
  const levels: unknown[] = [];
  console.log = console.error = (line: unknown) => void levels.push(JSON.parse(String(line)).level);
  process.env.LOG_LEVEL = level;
  for (const write of [log.debug, log.info, log.warn, log.error]) write("line");
  await Effect.runPromise(Effect.all([Effect.logDebug("line"), Effect.logInfo("line"), Effect.logWarning("line"), Effect.logError("line")]).pipe(Effect.provide(LoggerLive)));
  return levels;
}

test("each level writes its own lines and the ones above it", async () => {
  expect(await written("debug")).toEqual(["debug", "info", "warn", "error", "debug", "info", "warn", "error"]);
  expect(await written("info")).toEqual(["info", "warn", "error", "info", "warn", "error"]);
  expect(await written("warn")).toEqual(["warn", "error", "warn", "error"]);
  expect(await written("error")).toEqual(["error", "error"]);
  expect(await written("silent")).toEqual([]);
});
