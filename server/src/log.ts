// Structured logging: one JSON object per line on stdout, which every host
// (Railway included) collects and makes searchable. Each request gets an id
// that is added to every line logged while handling it.
//
// Wide events ("canonical log lines"): what happens during a request is added
// to its context with event(), not logged on its own line. The request's one
// line at the end (app.ts) then says it all: who, what happened, status, time,
// and the trace id to open the same request in Sentry. docs/DEPLOY.md lists
// the fields. Ids, counts and small enums only: never emails, codes or bodies.
//
// Effect code logs with Effect.logInfo and friends (the `logger` below);
// the request context comes from the fiber (request.ts). Promise code (Better
// Auth, sync.ts, ai.ts, scripts) uses `log` and `event`, which find the
// request through request.ts's bridge.

import * as Sentry from "@sentry/bun";
import { Cause, Context, Layer, Logger, References, type LogLevel } from "effect";
import { bridgedRequest, inSentryScope, record, RequestContext, type RequestInfo } from "./request";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function write(level: Level, msg: string, fields: Fields, ctx: RequestInfo | undefined) {
  // Read on every line, not once: tests turn logging up and down around a block.
  if (process.env.LOG_LEVEL === "silent") return;
  if (level === "debug" && process.env.LOG_LEVEL !== "debug") return;
  const pretty = process.env.LOG_PRETTY === "1";
  const line: Fields & { ts: string } = { ts: new Date().toISOString(), level, msg, ...ctx?.fields, ...fields };
  if (fields.err instanceof Error) line.err = { message: fields.err.message, stack: fields.err.stack };
  const out = pretty ? `${String(line.ts).slice(11, 19)} ${level.padEnd(5)} ${msg} ${JSON.stringify({ ...line, ts: undefined, level: undefined, msg: undefined })}` : JSON.stringify(line);
  (level === "error" || level === "warn" ? console.error : console.log)(out);
  // Warnings and errors go to Sentry logs too (a no-op without SENTRY_DSN), on
  // the request's trace. The fields are ours: ids, paths, timings; never
  // request bodies or emails.
  if (level === "warn" || level === "error") {
    const { ts: _ts, level: _level, msg: _msg, err, ...attrs } = line;
    const send = () => Sentry.logger[level](msg, { ...attrs, ...(err ? { err: JSON.stringify(err) } : {}) });
    if (ctx) inSentryScope(ctx, send);
    else send();
  }
}

/** For code outside Effect: Better Auth's logger and hooks, sync.ts, ai.ts, the scripts and signal handlers. */
export const log = {
  debug: (msg: string, f: Fields = {}) => write("debug", msg, f, bridgedRequest()),
  info: (msg: string, f: Fields = {}) => write("info", msg, f, bridgedRequest()),
  warn: (msg: string, f: Fields = {}) => write("warn", msg, f, bridgedRequest()),
  error: (msg: string, f: Fields = {}) => write("error", msg, f, bridgedRequest()),
};

/**
 * Something that happened in this request, from Promise code (Effect code
 * uses request.ts's `event`). Outside a request (the scripts) there is no
 * line to add it to.
 */
export function event(fields: Fields) {
  const ctx = bridgedRequest();
  if (ctx) record(ctx, fields);
}

function levelOf(level: LogLevel.LogLevel): Level {
  switch (level) {
    case "Trace":
    case "Debug":
      return "debug";
    case "Info":
      return "info";
    case "Warn":
      return "warn";
    case "Error":
    case "Fatal":
      return "error";
    case "All":
    case "None":
      // Thresholds for filtering, never the level of a line.
      throw new Error(`no lines are logged at level ${level}`);
  }
}

/**
 * Effect's logger, writing the same lines. The message is the first part; the
 * fields are the request's context (from the fiber) and Effect.annotateLogs.
 * A failure logged with its cause (Effect's own reports) keeps it as `err`.
 */
const logger = Logger.make<unknown, void>(({ logLevel, message, fiber, cause }) => {
  const parts = Array.isArray(message) ? message : [message];
  const fields: Fields = { ...fiber.getRef(References.CurrentLogAnnotations) };
  if (cause.reasons.length) fields.err = Cause.squash(cause);
  write(levelOf(logLevel), String(parts[0]), fields, Context.getOrUndefined(fiber.context, RequestContext));
});

/** Effect logs through `logger` only. */
export const LoggerLive = Layer.mergeAll(
  Logger.layer([logger]),
  // write() filters by LOG_LEVEL; Effect's own default (Info) would drop Effect.logDebug first.
  Layer.succeed(References.MinimumLogLevel, "All"),
);

/** The trace a request runs in, to find its log line in Sentry (none without Sentry). Read where the request comes in. */
export function traceId(): string | undefined {
  if (!Sentry.isInitialized()) return undefined;
  return Sentry.getActiveSpan()?.spanContext().traceId ?? Sentry.getCurrentScope().getPropagationContext().traceId;
}
