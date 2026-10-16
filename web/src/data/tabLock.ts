// One tab writes: the user's write queue is shared by their tabs, so only the
// tab holding the user's Web Lock sends it (see store.ts and App's WriterOnly).

import type { LeaderElection } from "@tanstack/offline-transactions";
import { Deferred, Effect, Fiber } from "effect";

/** How long a new tab waits for the lock before it says it is not the writer. */
const FIRST_ANSWER = "2500 millis";

/**
 * Holds the Web Lock `name` from when the browser grants it until the scope
 * closes. It waits in line for as long as it takes; interrupting it leaves
 * the line.
 */
const holdLock = (name: string) =>
  Effect.acquireRelease(
    Effect.callback<() => void>((resume, signal) => {
      navigator.locks
        .request(name, { mode: "exclusive", signal }, () => new Promise<void>((release) => resume(Effect.succeed(release))))
        // Rejects when this tab leaves the line (the signal): nothing to do. If
        // the browser refused the lock instead, this tab is not the writer,
        // which requestLeadership says once its wait is over.
        .catch(() => {});
    }),
    (release) => Effect.sync(release),
    { interruptible: true },
  );

/**
 * The user's Web Lock: the tab holding it sends the queue. A tab that opens
 * while another holds it waits a moment (a reload, or React's development
 * double mount, releases it quickly), then reports "not the writer" but stays
 * in line, and becomes the writer if the other tab closes.
 */
export function tabLock(name: string): LeaderElection | undefined {
  if (typeof navigator === "undefined" || !("locks" in navigator)) return undefined;
  let leader = false;
  const listeners = new Set<(isLeader: boolean) => void>();
  const set = (v: boolean) => {
    if (leader === v) return;
    leader = v;
    for (const l of listeners) l(v);
  };
  // In line for the lock, then holding it, until released.
  let holder: Fiber.Fiber<never> | null = null;
  return {
    requestLeadership: () =>
      Effect.runPromise(
        Effect.gen(function* () {
          if (leader) return true;
          const granted = yield* Deferred.make<void>();
          holder = yield* Effect.scoped(
            Effect.gen(function* () {
              yield* holdLock(name);
              set(true);
              yield* Deferred.succeed(granted, undefined);
              return yield* Effect.never;
            }),
          ).pipe(Effect.forkDetach({ startImmediately: true }));
          return yield* Deferred.await(granted).pipe(
            Effect.as(true),
            Effect.timeoutOrElse({ duration: FIRST_ANSWER, orElse: () => Effect.succeed(false) }),
          );
        }),
      ),
    releaseLeadership: () => {
      if (holder) Effect.runFork(Fiber.interrupt(holder));
      holder = null;
      set(false);
    },
    isLeader: () => leader,
    onLeadershipChange: (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}
