// How the offline queue (store.ts) sends a batch, and which failures it tries
// again. TanStack's default retry rule decides the rest: it gives up when the
// error's message has "400", "401", "403" or "422" in it.

import { NonRetriableError } from "@tanstack/offline-transactions";
import { Effect, Schema } from "effect";
import { reportBadAnswer } from "../observability";
import { ApiError, HttpError, isPermanent, sendWrite } from "./http";

/** Signed in as someone else since (in another tab): this user's writes wait for them. */
export class OtherUser extends Schema.TaggedError<OtherUser>()("OtherUser", {}) {
  // The same message as before: the default retry rule reads it.
  override get message() {
    return "other_user";
  }
}

/**
 * A session that expired offline, another user signed in here, or an app that
 * must reload first: keep the queued writes (they are this user's) and try
 * again later. Also when the answer is not one of ours (a proxy's 401 or 426).
 */
const retryLater = (e: unknown) =>
  e instanceof OtherUser ||
  (e instanceof ApiError && (e.body.error === "sign_in_required" || e.body.error === "please_reload")) ||
  (e instanceof HttpError && (e.status === 401 || e.status === 426));

/** The queue's shouldRetry: true to try again later; undefined leaves it to the default rule. */
export const shouldRetry = (e: Error) => (retryLater(e) ? true : undefined);

/**
 * Send one queued batch. A refusal for good is passed to `onRefused` and
 * fails with NonRetriableError, so the queue rolls it back. An answer that
 * breaks the contract comes after the server applied the write: it is
 * reported once and counted as sent, with no echo to wait for (null).
 */
export const sendQueued = (mutations: readonly unknown[], idempotencyKey: string, onRefused: (e: ApiError | HttpError) => void) =>
  sendWrite(mutations, idempotencyKey).pipe(
    Effect.catchIf(
      (e): e is ApiError | HttpError => (e._tag === "ApiError" || e._tag === "HttpError") && isPermanent(e),
      (e) => {
        onRefused(e);
        return Effect.fail(new NonRetriableError(`rejected: ${e.message}`));
      },
    ),
    Effect.catchTag("BadAnswer", (e) => Effect.sync(() => (reportBadAnswer(e.path, String(e.cause)), null))),
  );
