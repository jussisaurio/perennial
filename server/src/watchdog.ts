// Problems that are not exceptions but still deserve an issue: a request that
// takes far too long, and an event loop that stops turning (one synchronous
// job blocks every request). Each becomes a Sentry issue, grouped by a stable
// fingerprint so a recurring problem stays one issue. Both are also logged.

import * as Sentry from "@sentry/bun";
import { log } from "./log";

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

/** Watch the event loop: a timer that fires late means something held it. */
export function watchEventLoop(): () => void {
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const blocked = Math.round(now - last - TICK_MS);
    last = now;
    if (blocked < BLOCKED_MS) return;
    log.warn("event loop blocked", { ms: blocked });
    Sentry.captureMessage("Event loop blocked", { level: "warning", fingerprint: ["event-loop-blocked"], extra: { ms: blocked } });
  }, TICK_MS);
  timer.unref();
  return () => clearInterval(timer);
}
