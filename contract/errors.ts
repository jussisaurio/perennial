// Every error the server answers with: the body `{ error: code, ...fields }`
// and its HTTP status. One code has one status and one set of fields. Better
// Auth's own answers (under /api/auth/) and static files are not listed: they
// are not ours.

import { Schema } from "effect";

/** An error with no fields besides its code. */
const bare = <const C extends string>(code: C) => Schema.Struct({ error: Schema.tag(code) });

/** A refused request body: what is wrong, and where (at most five). */
export const Issue = Schema.Struct({ path: Schema.Array(Schema.Union([Schema.String, Schema.Number])), message: Schema.String });
export type Issue = typeof Issue.Type;

export const ApiErrorBody = Schema.Union([
  // The request itself
  bare("body_too_large"),
  Schema.Struct({ error: Schema.tag("bad_request"), issues: Schema.Array(Issue) }),
  bare("cross_origin"),
  bare("json_only"),
  bare("not_found"),
  bare("method_not_allowed"),
  Schema.Struct({ error: Schema.tag("please_reload"), minVersion: Schema.String }),
  // Who is asking
  bare("sign_in_required"),
  bare("account_required"),
  // Sync
  bare("unknown_shape"),
  bare("unknown_table"),
  Schema.Struct({ error: Schema.tag("quota"), table: Schema.Literals(["user_word", "user_sentence", "word_state", "reviewsPerDay"]), limit: Schema.Number }),
  Schema.Struct({ error: Schema.tag("unknown_word"), word_id: Schema.String }),
  bare("review_from_the_future"),
  // The garden's bowl (#351): a day in the future, from a device clock that is wrong.
  bare("garden_from_the_future"),
  // Perennial AI
  Schema.Struct({
    error: Schema.tag("out_of_credits"),
    used: Schema.Number,
    limit: Schema.Number,
    left: Schema.Number,
    period: Schema.String,
    needed: Schema.Number,
  }),
  bare("slow_down"),
  bare("ai_off"),
  Schema.Struct({ error: Schema.tag("paused"), until: Schema.String }),
  bare("busy"),
  bare("ai_unreachable"),
  // The model provider's HTTP status, when it gave one.
  Schema.Struct({ error: Schema.tag("ai_error"), status: Schema.optional(Schema.Number) }),
  bare("bad_output"),
  // Development only (/api/dev/outbox)
  bare("no_mail"),
  // A bug: the id finds the request's log lines and error report.
  Schema.Struct({ error: Schema.tag("internal_error"), requestId: Schema.String }),
]).pipe(Schema.toTaggedUnion("error"));
export type ApiErrorBody = typeof ApiErrorBody.Type;
export type ErrorCode = ApiErrorBody["error"];

export const ERROR_STATUS = {
  body_too_large: 413,
  bad_request: 422,
  cross_origin: 403,
  json_only: 415,
  not_found: 404,
  method_not_allowed: 405,
  please_reload: 426,
  sign_in_required: 401,
  account_required: 403,
  unknown_shape: 400,
  unknown_table: 400,
  quota: 429,
  unknown_word: 422,
  review_from_the_future: 422,
  garden_from_the_future: 422,
  out_of_credits: 402,
  slow_down: 429,
  ai_off: 503,
  paused: 503,
  busy: 503,
  ai_unreachable: 502,
  ai_error: 502,
  bad_output: 502,
  no_mail: 404,
  internal_error: 500,
} as const satisfies Record<ErrorCode, number>;
