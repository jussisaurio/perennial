// Talking to our server: one fetch wrapper that checks every answer and every
// error with the wire contract (contract/), and the one way to send writes
// (the offline queue, starting a course, the dev demo).

import { Effect, Option, Schema } from "effect";
import { ApiErrorBody, WriteResult, type ErrorCode } from "perennial-contract";
import { APP_VERSION } from "../version";

/** The server refused, with one of the contract's error bodies. */
export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", { body: ApiErrorBody }) {
  // The code, as before: the offline queue's default retry rule reads the message (store.ts).
  override get message() {
    return this.body.error;
  }
}

/**
 * An error answer this app can't read as one of the contract's: a proxy's
 * error page (no code), or a code or fields from a newer server (the code, when
 * the body has one).
 */
export class HttpError extends Schema.TaggedError<HttpError>()("HttpError", { status: Schema.Number, code: Schema.optional(Schema.String) }) {
  // As before: the code, else http_<status>. The offline queue's default retry rule reads it (store.ts).
  override get message() {
    return this.code ?? `http_${this.status}`;
  }
}

/** A success answer that breaks the contract: a bug on one side. `body` is what came, for the callers that can still use part of it. */
export class BadAnswer extends Schema.TaggedError<BadAnswer>()("BadAnswer", { path: Schema.String, body: Schema.Unknown, cause: Schema.Defect() }) {
  override get message() {
    return `bad answer from ${this.path}`;
  }
}

/** The code of an error body that is not one of the contract's, if it has one. */
const SomeCode = Schema.Struct({ error: Schema.String });

/** No answer: offline, or the connection broke. */
export class NetworkError extends Schema.TaggedError<NetworkError>()("NetworkError", { cause: Schema.Defect() }) {
  // The browser's own words ("Failed to fetch"), as the screens showed before.
  override get message() {
    return this.cause instanceof Error ? this.cause.message : String(this.cause);
  }
}

/**
 * Codes where sending the same request again would never succeed: it is
 * invalid, or over a storage limit. Every code is listed, so a new one does
 * not compile until it says.
 */
const PERMANENT = {
  body_too_large: true,
  bad_request: true,
  cross_origin: false,
  json_only: false,
  not_found: false,
  method_not_allowed: false,
  please_reload: false,
  sign_in_required: false,
  account_required: false,
  unknown_shape: false,
  unknown_table: false,
  quota: true,
  unknown_word: true,
  review_from_the_future: true,
  garden_from_the_future: true,
  out_of_credits: false,
  slow_down: false,
  ai_off: false,
  paused: false,
  busy: false,
  ai_unreachable: false,
  ai_error: false,
  bad_output: false,
  no_mail: false,
  internal_error: false,
} as const satisfies Record<ErrorCode, boolean>;

/**
 * Sending it again would never succeed. An error body this app can't read (a
 * newer server's) is judged by the rule from before the contract: its status,
 * and quota by its code.
 */
export const isPermanent = (e: ApiError | HttpError): boolean =>
  e._tag === "ApiError" ? PERMANENT[e.body.error] : e.status === 413 || e.status === 422 || (e.status === 429 && e.code === "quota");

/**
 * Ask the user to reload when the server needs a newer app. `needed` stays
 * true: the first check at start can fire before the note is on screen.
 */
export const reloadNeeded = new (class extends EventTarget {
  needed = false;
  constructor() {
    super();
    this.addEventListener("reload", () => (this.needed = true));
  }
})();

/** A request to our server, its answer checked with `schema` and its errors with the contract. */
export const request = Effect.fn("Http.request")(function* <S extends Schema.Decoder<unknown>>(schema: S, path: string, init: RequestInit = {}) {
  const res = yield* Effect.tryPromise({ try: (signal) => fetch(path, { ...init, signal }), catch: (cause) => new NetworkError({ cause }) });
  // An error page (from a proxy, say) has no JSON body: null, and the status still says what failed.
  const body = yield* Effect.promise((): Promise<unknown> => res.json().catch(() => null));
  // One rule for every call, whatever the body says: the server needs a newer app.
  if (res.status === 426) reloadNeeded.dispatchEvent(new Event("reload"));
  if (res.ok) return yield* Schema.decodeUnknownEffect(schema)(body).pipe(Effect.mapError((cause) => new BadAnswer({ path, body, cause })));
  const error = Schema.decodeUnknownOption(ApiErrorBody)(body);
  if (Option.isSome(error)) return yield* new ApiError({ body: error.value });
  return yield* new HttpError({ status: res.status, code: Option.getOrUndefined(Schema.decodeUnknownOption(SomeCode)(body))?.error });
});

/** Send changes in the server's mutation format (contract/write.ts). */
export const sendWrite = (mutations: readonly unknown[], idempotencyKey: string) =>
  request(WriteResult, "/api/write", {
    method: "POST",
    headers: { "content-type": "application/json", "x-perennial-version": APP_VERSION, "idempotency-key": idempotencyKey },
    body: JSON.stringify({ mutations }),
  });

/** `sendWrite`, for Promise code. A one-off write (no queue, so no retries) gets a fresh idempotency key. */
export const postWrite = (mutations: readonly unknown[], opts: { idempotencyKey?: string } = {}) => Effect.runPromise(sendWrite(mutations, opts.idempotencyKey ?? crypto.randomUUID()));
