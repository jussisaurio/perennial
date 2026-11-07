// How the store (store.ts) sends its writes: in the order made, the oldest
// ones together in one request, each tried again until the server has it,
// unless the server refuses it for good.

import { Cause, Effect, Exit, Result, Schema } from "effect";
import { MAX_BATCH, type WriteResult } from "perennial-contract";
import { reportBadAnswer, reportError } from "../observability";
import { ApiError, HttpError, isPermanent, sendWrite, type Batch } from "./http";

/** Signed in as someone else since (in another tab): this user's writes wait for them. */
class OtherUser extends Schema.TaggedError<OtherUser>()("OtherUser", {}) {}

/** The server refused the write for good: sending it again would never succeed. @internal Exported for tests. */
export class Refused extends Schema.TaggedError<Refused>()("Refused", { cause: Schema.Defect() }) {
  override get message() {
    return `rejected: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

interface SendOptions {
  otherUser: () => boolean;
  wake: () => Promise<void>;
  onRefused: (e: ApiError | HttpError) => void;
}

/** Between tries: 1 s, doubling, at most 30 s. */
const FIRST_WAIT_MS = 1000;
const LONGEST_WAIT_MS = 30_000;

/**
 * One try. A refusal for good is passed to `onRefused` and fails as Refused.
 * An answer that breaks the contract comes after the server applied the
 * write: it is reported once and counted as sent (null).
 */
const sendOnce = (batch: Batch, onRefused: (e: ApiError | HttpError) => void) =>
  sendWrite(batch).pipe(
    Effect.catchIf(
      (e): e is ApiError | HttpError => (e._tag === "ApiError" || e._tag === "HttpError") && isPermanent(e),
      (e) => {
        onRefused(e);
        return Effect.fail(new Refused({ cause: e }));
      },
    ),
    Effect.catchTag("BadAnswer", (e) => Effect.sync(() => (reportBadAnswer(e.path, String(e.cause)), null))),
  );

/**
 * Send until the server has it. Every failure but a refusal is tried again:
 * no connection, a lost session, an app that must reload first, an answer
 * this app can't read, or another user signed in here (`otherUser`). A wait
 * between tries ends early when `wake` resolves (back online, say).
 * @internal Exported for tests.
 */
export const sendUntilStored = (batch: Batch, opts: SendOptions) =>
  Effect.gen(function* () {
    const once = Effect.gen(function* () {
      if (opts.otherUser()) return yield* new OtherUser();
      return yield* sendOnce(batch, opts.onRefused);
    });
    for (let wait = FIRST_WAIT_MS; ; wait = Math.min(wait * 2, LONGEST_WAIT_MS)) {
      const tried = yield* Effect.result(once);
      if (Result.isSuccess(tried)) return tried.success;
      if (tried.failure._tag === "Refused") return yield* tried.failure;
      yield* Effect.race(Effect.sleep(wait), Effect.promise(opts.wake));
    }
  });

/**
 * Browsers refuse a keepalive request (the one sent as the page goes away)
 * whose body is over 64 KB. Every request is held under it, less room for the
 * rest of the body; a write is never split.
 */
const MAX_BYTES = 64 * 1024 - 100;
const utf8 = new TextEncoder();

interface Queued {
  seq: number;
  mutations: readonly unknown[];
  /** At most its share of a request body: its JSON, and up to 11 characters per mutation for its number. */
  bytes: number;
  stored: (r: WriteResult | null) => void;
  failed: (e: unknown) => void;
}

/**
 * The writes the server does not have yet, sent in the order made. Each
 * request takes the oldest ones that fit, so a backlog (made while offline)
 * goes in a few requests. The writes are numbered, and the server applies each
 * number once (server/src/sync.ts), so a write sent twice (its answer was
 * lost, or the page went away while it was on the way) is applied once, in order.
 */
export function writeQueue(opts: SendOptions & { signal: AbortSignal }) {
  const tab = crypto.randomUUID();
  let nextSeq = 0;
  const queue: Queued[] = [];
  // The server refuses a whole request for one bad write: after that, its
  // writes go one at a time, so only the bad one is refused.
  let alone = 0;
  let running = false;

  /** The oldest writes that fit in one request. `oneAlways`: also one that is too big alone (only a keepalive request must fit). */
  const oldest = (most: number, oneAlways: boolean) => {
    let bytes = 0;
    let count = 0;
    let n = 0;
    for (const w of queue.slice(0, most)) {
      if (bytes + w.bytes > MAX_BYTES || count + w.mutations.length > MAX_BATCH) {
        if (n === 0 && oneAlways) n = 1;
        break;
      }
      bytes += w.bytes;
      count += w.mutations.length;
      n++;
    }
    return queue.slice(0, n);
  };
  const batch = (writes: readonly Queued[]): Batch => ({
    mutations: writes.flatMap((w) => w.mutations),
    from: { tab, seq: writes.flatMap((w) => w.mutations.map(() => w.seq)) },
  });

  async function run() {
    running = true;
    while (queue.length) {
      const writes = oldest(alone ? 1 : queue.length, true);
      // Only a write refused alone counts as refused: a refused batch is sent again, one write at a time.
      const exit = await Effect.runPromiseExit(
        sendUntilStored(batch(writes), { ...opts, onRefused: (e) => writes.length === 1 && opts.onRefused(e) }),
        { signal: opts.signal },
      );
      if (opts.signal.aborted) {
        // The store is disposed (a sign-out or a new user): nothing more is sent.
        for (const w of queue.splice(0)) w.failed(opts.signal.reason);
        break;
      }
      if (alone) alone--;
      if (Exit.isFailure(exit) && writes.length > 1) {
        alone = writes.length;
        continue;
      }
      queue.splice(0, writes.length);
      for (const w of writes) {
        if (Exit.isSuccess(exit)) w.stored(exit.value);
        else w.failed(Cause.squash(exit.cause));
      }
    }
    running = false;
  }

  return {
    /** Send one write's changes. Resolves once the server has them (null: its answer broke the contract, reported); rejects with Refused. */
    send(mutations: readonly unknown[]) {
      return new Promise<WriteResult | null>((stored, failed) => {
        const bytes = utf8.encode(JSON.stringify(mutations)).length + 11 * mutations.length;
        queue.push({ seq: nextSeq++, mutations, bytes, stored, failed });
        if (!running) void run();
      });
    },
    /**
     * The page is going away: the oldest writes that fit go in one request that
     * outlives it, also those on the way now (the server skips a copy). Nothing
     * can try again after this: if it fails, they are lost, and so are the ones
     * that did not fit (reported).
     */
    pageHide() {
      if (!queue.length || opts.otherUser()) return;
      const writes = oldest(queue.length, false);
      if (writes.length < queue.length) reportError(new Error(`pagehide: ${queue.length - writes.length} of ${queue.length} unsent writes did not fit`));
      if (writes.length) Effect.runFork(sendWrite(batch(writes), true).pipe(Effect.ignore));
    },
  };
}
