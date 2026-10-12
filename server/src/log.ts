// Structured logging: one JSON object per line on stdout, which every host
// (Railway included) collects and makes searchable. Each request gets an id
// that is added to every line logged while handling it.
//
// Wide events ("canonical log lines"): what happens during a request is added
// to its context with event(), not logged on its own line. The request's one
// line at the end (app.ts) then says it all: who, what happened, status, time,
// and the trace id to open the same request in Sentry. docs/DEPLOY.md lists
// the fields. Ids, counts and small enums only: never emails, codes or bodies.

import { AsyncLocalStorage } from "node:async_hooks";
import * as Sentry from "@sentry/bun";

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const context = new AsyncLocalStorage<Fields>();
function write(level: Level, msg: string, fields: Fields = {}) {
  if (process.env.LOG_LEVEL === "silent") return;
  const pretty = process.env.LOG_PRETTY === "1";
  const line: Fields & { ts: string } = { ts: new Date().toISOString(), level, msg, ...context.getStore(), ...fields };
  if (fields.err instanceof Error) line.err = { message: fields.err.message, stack: fields.err.stack };
  const out = pretty ? `${String(line.ts).slice(11, 19)} ${level.padEnd(5)} ${msg} ${JSON.stringify({ ...line, ts: undefined, level: undefined, msg: undefined })}` : JSON.stringify(line);
  (level === "error" || level === "warn" ? console.error : console.log)(out);
  // Warnings and errors go to Sentry logs too (a no-op without SENTRY_DSN). The
  // fields are ours: ids, paths, timings; never request bodies or emails.
  if (level === "warn" || level === "error") {
    const { ts: _ts, level: _level, msg: _msg, err, ...attrs } = line;
    Sentry.logger[level](msg, { ...attrs, ...(err ? { err: JSON.stringify(err) } : {}) });
  }
}

export const log = {
  debug: (msg: string, f?: Fields) => process.env.LOG_LEVEL === "debug" && write("debug", msg, f),
  info: (msg: string, f?: Fields) => write("info", msg, f),
  warn: (msg: string, f?: Fields) => write("warn", msg, f),
  error: (msg: string, f?: Fields) => write("error", msg, f),
};

/** Run `fn` with fields (request id, user id…) attached to every log line inside it. */
export const withLogContext = <T>(fields: Fields, fn: () => T): T => context.run({ ...context.getStore(), ...fields }, fn);

/** Add fields to the current context, e.g. the user id once the session is known. */
export function addLogContext(fields: Fields) {
  const store = context.getStore();
  if (store) Object.assign(store, fields);
}

/**
 * Something that happened in this request (or job): it goes on the request's
 * line, and on its Sentry trace, so traces can be filtered by it too.
 */
export function event(fields: Fields) {
  addLogContext(fields);
  const span = Sentry.getActiveSpan();
  if (!span) return;
  const attrs = Object.fromEntries(Object.entries(fields).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))) as Record<string, string | number | boolean>;
  Sentry.getRootSpan(span).setAttributes(attrs);
}

/** The trace this code runs in, to find a log line's request in Sentry (none without Sentry). */
export function traceId(): string | undefined {
  if (!Sentry.isInitialized()) return undefined;
  return Sentry.getActiveSpan()?.spanContext().traceId ?? Sentry.getCurrentScope().getPropagationContext().traceId;
}
