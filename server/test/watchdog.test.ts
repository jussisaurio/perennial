// The event-loop watchdog: a loop held for a while is logged (and reported),
// and the worker stops with its layer, as at shutdown. Real time: blocking the
// loop is the behaviour under test.

import { expect, test } from "bun:test";
import { Effect, Exit, Layer, Scope } from "effect";
import { LoggerLive } from "../src/log";
import { WatchdogLive } from "../src/watchdog";

test("a blocked event loop is logged, until the watchdog's scope closes", async () => {
  const lines: Record<string, unknown>[] = [];
  const saved = { error: console.error, level: process.env.LOG_LEVEL };
  console.error = (line: unknown) => void lines.push(JSON.parse(String(line)));
  process.env.LOG_LEVEL = "info";
  const block = (ms: number) => {
    const end = performance.now() + ms;
    while (performance.now() < end); // hold the loop, as a slow synchronous job would
  };
  try {
    const scope = Effect.runSync(Scope.make());
    await Effect.runPromise(Layer.buildWithScope(WatchdogLive.pipe(Layer.provideMerge(LoggerLive)), scope));
    await Bun.sleep(300);
    block(800);
    await Bun.sleep(300);
    expect(lines.filter((l) => l.msg === "event loop blocked").map((l) => Number(l.ms) >= 500)).toEqual([true]);

    await Effect.runPromise(Scope.close(scope, Exit.void));
    block(800);
    await Bun.sleep(300);
    expect(lines.filter((l) => l.msg === "event loop blocked")).toHaveLength(1);
  } finally {
    console.error = saved.error;
    process.env.LOG_LEVEL = saved.level;
  }
});
