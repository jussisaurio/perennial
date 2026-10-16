// Problems that are not exceptions but still deserve an issue: a request that
// takes far too long, and an event loop that stops turning (one synchronous
// job blocks every request). Each becomes a Sentry issue, grouped by a stable
// fingerprint so a recurring problem stays one issue. Both are also logged.

import * as Sentry from "@sentry/bun";
import { Effect, Layer, Schedule } from "effect";

/** A request slower than this (ms) is a problem, not just a warning. */
export const VERY_SLOW_MS = 5000;
/** The loop was stuck at least this long (ms) between two ticks. */
const BLOCKED_MS = 500;
const TICK_MS = 250;

export function reportVerySlow(method: string, route: string, status: number, ms: number) {
  Sentry.captureMessage(`Very slow request: ${method} ${route}`, {
    level: "warning",
    fingerprint: ["very-slow-request", method, route],
    tags: { route, status: String(status) },
    extra: { ms },
  });
}

/**
 * Watch the event loop: a tick that comes late means something held it. A
 * worker in the layer's scope, so shutdown stops it.
 */
export const WatchdogLive = Layer.effectDiscard(
  Effect.gen(function* () {
    // Not a request's problem: report it with the scopes the process started with,
    // given explicitly (a fiber can run in a request's AsyncLocalStorage).
    const scopes = { scope: Sentry.getCurrentScope(), isolationScope: Sentry.getIsolationScope() };
    let last = performance.now();
    const tick = Effect.gen(function* () {
      const now = performance.now();
      const blocked = Math.round(now - last - TICK_MS);
      last = now;
      if (blocked < BLOCKED_MS) return;
      yield* Effect.logWarning("event loop blocked").pipe(Effect.annotateLogs({ ms: blocked }));
      Sentry.withIsolationScope(scopes.isolationScope, () =>
        Sentry.withScope(scopes.scope, () =>
          Sentry.withActiveSpan(null, () => Sentry.captureMessage("Event loop blocked", { level: "warning", fingerprint: ["event-loop-blocked"], extra: { ms: blocked } })),
        ),
      );
    });
    yield* tick.pipe(Effect.repeat(Schedule.spaced(TICK_MS)), Effect.forkScoped);
  }),
);
