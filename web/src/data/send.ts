// How the store (store.ts) sends a write: tried again until the server has
// it, unless the server refuses it for good.

import { Effect, Result, Schema } from "effect";
import { reportBadAnswer } from "../observability";
import { ApiError, HttpError, isPermanent, sendWrite } from "./http";

/** Signed in as someone else since (in another tab): this user's writes wait for them. */
class OtherUser extends Schema.TaggedError<OtherUser>()("OtherUser", {}) {}

/** The server refused the write for good: sending it again would never succeed. */
export class Refused extends Schema.TaggedError<Refused>()("Refused", { cause: Schema.Defect() }) {
  override get message() {
    return `rejected: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`;
  }
}

/** Between tries: 1 s, doubling, at most 30 s. */
const FIRST_WAIT_MS = 1000;
const LONGEST_WAIT_MS = 30_000;

/**
 * One try. A refusal for good is passed to `onRefused` and fails as Refused.
 * An answer that breaks the contract comes after the server applied the
 * write: it is reported once and counted as sent (null).
 */
const sendOnce = (mutations: readonly unknown[], idempotencyKey: string, onRefused: (e: ApiError | HttpError) => void) =>
  sendWrite(mutations, idempotencyKey).pipe(
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
 */
export const sendUntilStored = (
  mutations: readonly unknown[],
  idempotencyKey: string,
  opts: { otherUser: () => boolean; wake: () => Promise<void>; onRefused: (e: ApiError | HttpError) => void },
) =>
  Effect.gen(function* () {
    const once = Effect.gen(function* () {
      if (opts.otherUser()) return yield* new OtherUser();
      return yield* sendOnce(mutations, idempotencyKey, opts.onRefused);
    });
    for (let wait = FIRST_WAIT_MS; ; wait = Math.min(wait * 2, LONGEST_WAIT_MS)) {
      const tried = yield* Effect.result(once);
      if (Result.isSuccess(tried)) return tried.success;
      if (tried.failure._tag === "Refused") return yield* tried.failure;
      yield* Effect.race(Effect.sleep(wait), Effect.promise(opts.wake));
    }
  });
