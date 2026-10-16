// One request's context, passed explicitly through Effect: its id, the web
// Request, the fields for its one log line (wide events, see log.ts), and its
// Sentry scopes. app.ts makes it where the request comes in.

import { AsyncLocalStorage } from "node:async_hooks";
import * as Sentry from "@sentry/bun";
import { Context, Effect } from "effect";
import { ApiError } from "./http";

type Fields = Record<string, unknown>;

export interface RequestInfo {
  /** The request as Better Auth and the shape proxy read it: with our client-IP header (clientIp.ts). */
  readonly request: Request;
  /** The request's log line so far: reqId, traceId, userId and every event(). */
  readonly fields: Fields;
  /** Sentry's scopes for this request: the trace, and the request data on error reports. */
  readonly sentry: { readonly scope: Sentry.Scope; readonly isolationScope: Sentry.Scope; readonly rootSpan: Sentry.Span | undefined };
}

export class RequestContext extends Context.Service<RequestContext, RequestInfo>()("perennial/RequestContext") {}

/** Fields on the request's line only, e.g. the user id once the session is known. */
export const annotate = (fields: Fields) => RequestContext.useSync((ctx) => void Object.assign(ctx.fields, fields));

/**
 * Something that happened in this request: it goes on the request's line, and
 * on its Sentry trace, so traces can be filtered by it too.
 */
export const event = (fields: Fields) => RequestContext.useSync((ctx) => record(ctx, fields));

export function record(ctx: RequestInfo, fields: Fields) {
  Object.assign(ctx.fields, fields);
  const attrs = Object.fromEntries(Object.entries(fields).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))) as Record<string, string | number | boolean>;
  ctx.sentry.rootSpan?.setAttributes(attrs);
}

/** Run `fn` with the request's Sentry scopes active, so what it reports or traces belongs to the request. */
export const inSentryScope = <T>(ctx: RequestInfo, fn: () => T): T =>
  Sentry.withIsolationScope(ctx.sentry.isolationScope, () => Sentry.withScope(ctx.sentry.scope, fn));

// Today's Promise modules (Better Auth and its hooks in auth.ts, sync.ts,
// ai.ts) call event() and log from their own promise chains, and Sentry finds
// the active span through AsyncLocalStorage. Effect fibers do not carry
// AsyncLocalStorage. So `promise` runs them inside a small AsyncLocalStorage
// scope that holds the request, local to this bridge. It goes when those
// modules become Effect services (#322, part 2).
const bridge = new AsyncLocalStorage<RequestInfo>();

/** The request whose Promise code is running now (see `promise`), for log.ts. */
export const bridgedRequest = () => bridge.getStore();

/**
 * Call a Promise module for this request, as a named effect. It refuses with
 * ApiError (typed); anything else it throws is a bug: a defect, answered 500.
 */
export const promise = <A>(name: string, run: () => Promise<A>): Effect.Effect<A, ApiError, RequestContext> =>
  RequestContext.use((ctx) =>
    Effect.tryPromise({ try: () => bridge.run(ctx, () => inSentryScope(ctx, run)), catch: (e) => e }).pipe(
      Effect.catch((e) => (e instanceof ApiError ? Effect.fail(e) : Effect.die(e))),
    ),
  ).pipe(Effect.withSpan(name));
