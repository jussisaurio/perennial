// The HTTP app: auth, sync (shape proxy + writes), Perennial AI, account
// deletion, and the built web app. Every request gets an id that appears in
// every log line, in the X-Request-Id response header, and in error reports.
//
// Effect's HTTP server runs it (BunHttpServer in index.ts). `handle` below is
// the edge: it makes the request's context (request.ts), routes, turns refusals
// and bugs into responses (in one place), logs the request's one line, and
// adds the headers every answer gets.

import { BunHttpServer } from "@effect/platform-bun";
import * as Sentry from "@sentry/bun";
import { Context, Effect, Layer, Schema } from "effect";
import type { Scope } from "effect";
import { HttpRouter, HttpServer, HttpServerError, HttpServerRequest, HttpServerResponse } from "effect/http";
import type { HttpMethod } from "effect/http/HttpMethod";
import { ExamplesIn, MineIn, UserId, WriteBatch, type Me, type ServerInfo } from "perennial-contract";
import { withClientIp } from "./clientIp";
import { AppConfig } from "./config";
import { ApiError, decodeBody, errorResponse, json, refuse, securityHeaders, serveStatic, versionAtLeast } from "./http";
import { traceId } from "./log";
import { annotate, event, inSentryScope, promise, RequestContext, sentrySpan, type RequestInfo } from "./request";
import { Mail, OutboxMailer } from "./mail";
import { Ai } from "./ai";
import { Auth, Database } from "./services";
import { LEARNER_TABLES, Sync } from "./sync";
import { reportVerySlow, VERY_SLOW_MS } from "./watchdog";

/**
 * The app had a service worker until #188 (offline mode, removed for now), and a
 * browser keeps a worker until it fetches a new /sw.js. This one removes itself:
 * it deletes the caches the old worker made (Workbox's precache and "pages"),
 * unregisters, and loads each open tab again from the network at `appUrl` (same
 * path and hash). On APP_URL that is a reload; on an old address, a move there.
 * Kept while browsers may still have the old worker; a new one for offline mode
 * (#188) would replace it.
 */
const retiringWorker = (appUrl: string) => `self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith("workbox-") || name === "pages") await caches.delete(name);
  await self.registration.unregister();
  for (const c of await self.clients.matchAll({ type: "window" })) {
    const u = new URL(c.url);
    c.navigate(${JSON.stringify(appUrl)} + u.pathname + u.search + u.hash);
  }
})()));
`;

/** A request slower than this (ms) is logged as a warning. */
const SLOW_MS = 1000;

/**
 * A web Response (Better Auth, the shape proxy, static files, the edge's own)
 * as Effect's response, untouched: the server sends the same object on. (Effect's
 * fromWeb would turn its body into a stream and re-encode its cookies.)
 */
const webResponse = (res: Response) => HttpServerResponse.raw(res, { status: res.status });

/**
 * The answer the edge sends. Effect's Bun server answers HEAD with a new, empty
 * Response, which Bun would send as content-length: 0: give it the length of
 * the GET answer, as Bun.serve did.
 */
const finish = (req: Request, res: Response) =>
  Effect.gen(function* () {
    if (req.method === "HEAD" && !res.headers.has("content-length")) res.headers.set("content-length", String((yield* Effect.promise(() => res.clone().blob())).size));
    return webResponse(res);
  });

/** The signed-in learner, as the app's code sees it: decoded from Better Auth's session. */
const SessionUser = Schema.Struct({ id: UserId, email: Schema.String, isAnonymous: Schema.optional(Schema.NullOr(Schema.Boolean)) });

type Handler = Effect.Effect<HttpServerResponse.HttpServerResponse, ApiError, RequestContext>;
type Methods = Partial<Record<HttpMethod, Handler>>;

/** The app's request handler, made from the services. */
export class App extends Context.Service<App, { readonly handle: Effect.Effect<HttpServerResponse.HttpServerResponse, never, HttpServerRequest.HttpServerRequest | Scope.Scope> }>()(
  "perennial/App",
) {}

export const AppLive = Layer.effect(
  App,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const sql = yield* Database;
    const mailer = yield* Mail;
    const auth = yield* Auth;
    const ai = yield* Ai;
    const sync = yield* Sync;
    const headers = securityHeaders([...new Set(config.observability.connect)], config.appUrl.startsWith("https://"), !!config.turnstile.siteKey);

    const session = Effect.gen(function* () {
      const { request } = yield* RequestContext;
      const s = yield* promise("Auth.getSession", () => auth.api.getSession({ headers: request.headers }));
      if (!s) return null;
      // A session Better Auth hands over without a usable user is a bug: a defect (500).
      const user = yield* Schema.decodeUnknownEffect(SessionUser)(s.user).pipe(Effect.orDie);
      yield* annotate({ userId: user.id });
      return user;
    });
    const requireUser = (opts: { real?: boolean } = {}) =>
      Effect.gen(function* () {
        const user = yield* session;
        if (!user) return yield* refuse({ error: "sign_in_required" });
        if (opts.real && user.isAnonymous) return yield* refuse({ error: "account_required" });
        return user;
      });
    /** Old clients must reload before they write: the server may expect newer data. */
    const requireFreshClient = Effect.gen(function* () {
      const { request } = yield* RequestContext;
      if (!versionAtLeast(request.headers.get("x-perennial-version"), config.minClientVersion)) return yield* refuse({ error: "please_reload", minVersion: config.minClientVersion });
    });
    const body = <S extends Schema.Decoder<unknown>>(schema: S, limit = 64 * 1024) => RequestContext.use(({ request }) => decodeBody(request, schema, limit));

    // The router finds the path; the path's own table picks the method (405
    // for the others, HEAD included, as before).
    //
    // Every request runs to its end even when the client goes away: a write,
    // an AI call (credits, spend), an account deletion or a sign-in that merges
    // an anonymous learner must not stop half-way. Bun's server interrupts a
    // request's fiber when its client disconnects. HttpEffect.toHandled makes
    // the whole request fiber uninterruptible from its start, which keeps
    // `handle`, Better Auth and static files going; HttpRouter makes a route
    // interruptible again unless it says `uninterruptible: true`. So never wrap
    // `handle` or a route in Effect.interruptible or Effect.timeout. (The shape
    // proxy stops its own upstream fetch: sync.ts.)
    const at = (path: `/${string}`, methods: Methods) =>
      HttpRouter.route(
        "*",
        path,
        Effect.gen(function* () {
          const incoming = yield* HttpServerRequest.HttpServerRequest;
          const { request } = yield* RequestContext;
          // The router also matches /API/me, /api/me/, //api/me and /api/m%65.
          // A route answers only its own path, exactly, as before; the others
          // are not found (404 under /api/, else the web app).
          if (new URL(request.url).pathname !== path) return yield* new HttpServerError.HttpServerError({ reason: new HttpServerError.RouteNotFound({ request: incoming }) });
          const handler = methods[incoming.method];
          return handler ? yield* handler : yield* refuse({ error: "method_not_allowed" });
        }),
        { uninterruptible: true },
      );

    const routes = [
      at("/health", {
        GET: Effect.gen(function* () {
          yield* promise("Database.ping", () => sql`select 1`);
          return json({ ok: true, release: config.release });
        }),
      }),
      // This server: its release, the oldest app version it accepts writes from,
      // and what it can do right now, so the app shows only what works
      // (web/src/data/server.ts). Public: it says nothing about the user.
      at("/api/server", {
        GET: Effect.sync(() => json({ release: config.release, minClientVersion: config.minClientVersion, features: { ai: ai.enabled } } satisfies ServerInfo, 200, { "cache-control": "no-cache" })),
      }),

      at("/api/shape", {
        GET: Effect.gen(function* () {
          const user = yield* requireUser();
          const { request } = yield* RequestContext;
          return webResponse(yield* sync.proxyShape(request, user.id));
        }),
      }),
      at("/api/write", {
        POST: Effect.gen(function* () {
          yield* requireFreshClient;
          const user = yield* requireUser();
          const { mutations } = yield* body(WriteBatch, 512 * 1024);
          const types: Record<string, number> = {};
          for (const m of mutations) types[m.type] = (types[m.type] ?? 0) + 1;
          // "review.insert:3 course.upsert:1": what the batch was, searchable as text.
          yield* event({ writes: mutations.length, writeTypes: Object.entries(types).map(([k, n]) => `${k}:${n}`).join(" ") });
          // A span per write batch, so a slow trace shows the database time (sampled, see instrument.ts).
          const result = yield* sentrySpan({ name: "write batch", op: "db.write", attributes: { mutations: mutations.length } }, sync.applyWrites(user.id, mutations));
          yield* event({ writeChanged: result.changed });
          return json(result);
        }),
      }),

      at("/api/me", {
        GET: Effect.gen(function* () {
          const user = yield* requireUser();
          const credits = yield* ai.credits(user.id);
          return json({ id: user.id, email: user.isAnonymous ? null : user.email, anonymous: !!user.isAnonymous, credits, ai: ai.enabled } satisfies Me);
        }),
      }),
      at("/api/ai/mine", {
        POST: Effect.gen(function* () {
          const user = yield* requireUser({ real: true });
          const input = yield* body(MineIn);
          return json(yield* ai.mine(user.id, input));
        }),
      }),
      at("/api/ai/examples", {
        POST: Effect.gen(function* () {
          const user = yield* requireUser({ real: true });
          const input = yield* body(ExamplesIn);
          return json(yield* ai.examples(user.id, input));
        }),
      }),

      at("/api/account/delete", {
        POST: Effect.gen(function* () {
          const user = yield* requireUser();
          // Everything the learner has cascades from the user row.
          yield* promise("Database.deleteUser", () => sql`delete from "user" where id = ${user.id}`);
          yield* event({ accountDeleted: true });
          return json({ ok: true });
        }),
      }),
    ];

    if (config.dev && mailer instanceof OutboxMailer) {
      // Lets tests and local development read sign-in codes. Never mounted in production.
      routes.push(at("/api/dev/outbox", {
        GET: Effect.gen(function* () {
          const { request } = yield* RequestContext;
          const email = new URL(request.url).searchParams.get("email") ?? "";
          const m = mailer.latest(email);
          return m ? json({ code: m.subject.match(/\d{6}/)?.[0], subject: m.subject }) : yield* refuse({ error: "no_mail" });
        }),
      }));
      // The signed-in learner's rows, as stored on the server (tests check what really arrived).
      routes.push(at("/api/dev/rows", {
        GET: Effect.gen(function* () {
          const user = yield* requireUser();
          const { request } = yield* RequestContext;
          const table = new URL(request.url).searchParams.get("table");
          if (!table || !LEARNER_TABLES.includes(table)) return yield* refuse({ error: "unknown_table" });
          return json(yield* promise("Database.rows", () => sql`select * from ${sql(table)} where user_id = ${user.id}`));
        }),
      }));
    }

    const router = yield* HttpRouter.toHttpEffect(HttpRouter.addAll(routes));

    /**
     * The only Better Auth endpoints the app uses (web/src/data/auth.ts). The
     * rest (passwords, email change, account linking, session lists, user
     * updates...) stay unreachable, whatever a future Better Auth enables.
     */
    const authEndpoints: Record<string, string[]> = {
      "/api/auth/get-session": ["GET"],
      "/api/auth/sign-out": ["POST"],
      "/api/auth/sign-in/anonymous": ["POST"],
      "/api/auth/email-otp/send-verification-otp": ["POST"],
      "/api/auth/sign-in/email-otp": ["POST"],
    };

    const appOrigin = new URL(config.appUrl).origin;
    /**
     * Cookie sessions: a state-changing request must come from our own page.
     * Browsers send Origin on every POST; a form or another site can't fake it,
     * and a JSON body can't be sent cross-origin without a preflight we don't allow.
     */
    const requireSameOrigin = (req: Request) =>
      Effect.gen(function* () {
        const origin = req.headers.get("origin");
        const site = req.headers.get("sec-fetch-site");
        if (origin ? origin !== appOrigin : site !== null && site !== "same-origin") return yield* refuse({ error: "cross_origin" });
        // No content type is not JSON either.
        if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return yield* refuse({ error: "json_only" });
      });

    const route = (req: Request, url: URL) =>
      Effect.gen(function* () {
        if (url.pathname.startsWith("/api/auth/")) {
          if (!authEndpoints[url.pathname]?.includes(req.method)) return yield* refuse({ error: "not_found" });
          return webResponse(yield* promise("Auth.handler", () => auth.handler(req)));
        }
        if (req.method !== "GET" && req.method !== "HEAD" && url.pathname.startsWith("/api/")) yield* requireSameOrigin(req);
        return yield* router.pipe(
          Effect.catchTag("HttpServerError", (e) => {
            if (e.reason._tag !== "RouteNotFound") return Effect.die(e);
            if (url.pathname.startsWith("/api/")) return Effect.fail(refuse({ error: "not_found" }));
            if (req.method !== "GET" && req.method !== "HEAD") return Effect.fail(refuse({ error: "method_not_allowed" }));
            return Effect.map(
              Effect.promise(() => serveStatic(config.staticDir, url.pathname)),
              webResponse,
            );
          }),
        );
      });

    // Other names for the app send people to the one in APP_URL (sign-in works
    // only there): www, and Railway's own domain once a custom domain is set.
    const appHost = new URL(config.appUrl).host;
    const isAlias = (host: string) => host !== appHost && (host === `www.${appHost}` || host.endsWith(".up.railway.app"));

    const handle = Effect.gen(function* () {
      // Sentry's Bun.serve wrapper keeps the request's trace in
      // AsyncLocalStorage, which Effect fibers do not carry. This fiber starts
      // synchronously inside Bun's call to the handler, so read it here, before
      // the first async step, and pass it on explicitly (RequestContext).
      const active = Sentry.getActiveSpan();
      const sentry = { scope: Sentry.getCurrentScope(), isolationScope: Sentry.getIsolationScope(), rootSpan: active && Sentry.getRootSpan(active) };
      const trace = traceId();

      const incoming = yield* HttpServerRequest.HttpServerRequest;
      // Effect's Bun server and its web handler both wrap the web Request.
      if (!(incoming.source instanceof Request)) return yield* Effect.die(new Error("the HTTP server did not hand over a web Request"));
      const req = withClientIp(incoming.source, config.clientIpHeaders);
      // `||`: an empty id is no id.
      const id = req.headers.get("x-request-id")?.slice(0, 64) || crypto.randomUUID();
      const url = new URL(req.url);
      // A browser that still has the old worker asks for /sw.js to update it: here, or
      // on an old address, where that worker serves the page from cache (so the redirect
      // below never reaches it). Not a redirect: a worker script that redirects fails
      // the update. no-cache: a CDN must not keep it. Logged with the host, so we can
      // see when old workers stop asking and retiringWorker can go.
      if (url.pathname === "/sw.js") {
        yield* Effect.logInfo("request").pipe(Effect.annotateLogs({ reqId: id, method: req.method, path: url.pathname, host: url.host, status: 200 }));
        return yield* finish(req, new Response(retiringWorker(config.appUrl), { headers: { "content-type": "text/javascript", "cache-control": "no-cache" } }));
      }
      if (isAlias(url.host)) return webResponse(new Response(null, { status: 308, headers: { location: config.appUrl + url.pathname + url.search } }));

      const ctx: RequestInfo = { request: req, fields: { reqId: id, traceId: trace }, sentry };
      const started = performance.now();
      const res = yield* route(req, url).pipe(
        Effect.catchTag("ApiError", (e) => Effect.succeed(errorResponse(e.body))),
        Effect.catchDefect((defect) =>
          Effect.gen(function* () {
            yield* Effect.logError("unhandled error").pipe(Effect.annotateLogs({ err: defect, path: url.pathname }));
            inSentryScope(ctx, () =>
              Sentry.withScope((scope) => {
                scope.setTag("request_id", id);
                Sentry.captureException(defect);
              }),
            );
            return errorResponse({ error: "internal_error", requestId: id });
          }),
        ),
        Effect.map((r) => HttpServerResponse.toWeb(r)),
        Effect.tap((res) => logRequest(ctx, req, url, res.status, Math.round(performance.now() - started))),
        Effect.provideService(RequestContext, ctx),
      );
      const out = new Response(res.body, res);
      out.headers.set("x-request-id", id);
      // API answers are per user and live: a CDN in front must never keep them.
      if (url.pathname.startsWith("/api/") && !out.headers.has("cache-control")) out.headers.set("cache-control", "no-store");
      for (const [k, v] of Object.entries(headers)) if (!out.headers.has(k)) out.headers.set(k, v);
      return yield* finish(req, out);
    });

    return App.of({ handle });
  }),
);

/** The request's one line (log.ts). */
const logRequest = (ctx: RequestInfo, req: Request, url: URL, status: number, ms: number) =>
  Effect.gen(function* () {
    // Shapes are long polls (held open until data changes, then cancelled by
    // the browser as 499): logging them would drown everything else.
    if (url.pathname === "/api/shape" && (status < 400 || status === 499)) return;
    // Slow requests stand out (warn) so they can be searched and alerted on. Live shape
    // polls wait ~20 s by design and AI calls take seconds, so neither counts.
    const slow = ms > SLOW_MS && url.pathname !== "/api/shape" && !url.pathname.startsWith("/api/ai/");
    yield* (slow ? Effect.logWarning("slow request") : Effect.logInfo("request")).pipe(Effect.annotateLogs({ method: req.method, path: url.pathname, status, ms }));
    // Grouped by route: API paths carry no ids; every static file is one route.
    if (slow && ms > VERY_SLOW_MS) inSentryScope(ctx, () => reportVerySlow(req.method, url.pathname.startsWith("/api/") ? url.pathname : "static", status, ms));
  });

/** Serve the app on the HTTP server. */
export const HttpLive = Layer.effectDiscard(Effect.flatMap(App, (app) => HttpServer.serveEffect(app.handle)));

/** Bun's HTTP server on `port` (index.ts; the tests use a free one). */
export const BunServerLive = (port: number) =>
  BunHttpServer.layer({
    port,
    // Bun.serve's own default; BunHttpServer's would be "::" (IPv6).
    hostname: "0.0.0.0",
    // Electric holds live shape requests open for ~20 s; Bun's default 10 s idle
    // timeout would cut them.
    idleTimeout: 0,
  });
