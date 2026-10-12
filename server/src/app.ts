// The HTTP app: auth, sync (shape proxy + writes), Perennial AI, account
// deletion, and the built web app. Every request gets an id that appears in
// every log line, in the X-Request-Id response header, and in error reports.

import * as Sentry from "@sentry/bun";
import type { SQL } from "bun";
import { z } from "zod";
import { AIService, ExamplesIn, MineIn } from "./ai";
import { createAuth } from "./auth";
import { withClientIp } from "./clientIp";
import type { Config } from "./config";
import { fail, HttpError, json, readJson, securityHeaders, serveStatic, versionAtLeast } from "./http";
import { addLogContext, event, log, traceId, withLogContext } from "./log";
import { createMailer, OutboxMailer } from "./mail";
import { handleWrite, LEARNER_TABLES, proxyShape } from "./sync";
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

export function createApp(config: Config, sql: SQL) {
  const mailer = createMailer(config);
  const { auth, pool } = createAuth(config, sql, mailer);
  const ai = new AIService(sql, config);
  const headers = securityHeaders(
    [...new Set(config.observability.connect)],
    config.appUrl.startsWith("https://"),
    !!config.turnstile.siteKey,
  );

  async function session(req: Request) {
    const s = await auth.api.getSession({ headers: req.headers });
    if (s) addLogContext({ userId: s.user.id });
    return s;
  }
  async function requireUser(req: Request, opts: { real?: boolean } = {}) {
    const s = await session(req);
    if (!s) throw new HttpError(401, "sign_in_required");
    if (opts.real && s.user.isAnonymous) throw new HttpError(403, "account_required");
    return s.user;
  }
  /** Old clients must reload before they write: the server may expect newer data. */
  function requireFreshClient(req: Request) {
    if (!versionAtLeast(req.headers.get("x-perennial-version"), config.minClientVersion)) throw new HttpError(426, "please_reload", { minVersion: config.minClientVersion });
  }
  const body = async <T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> => {
    const r = schema.safeParse(await readJson(req, 64 * 1024));
    if (!r.success) throw new HttpError(422, "bad_request", { issues: r.error.issues.slice(0, 5) });
    return r.data;
  };

  type Handler = (req: Request) => Promise<Response> | Response;
  const routes: Record<string, Partial<Record<string, Handler>>> = {
    "/health": {
      GET: async () => {
        await sql`select 1`;
        return json({ ok: true, release: config.release });
      },
    },
    // This server: its release, the oldest app version it accepts writes from,
    // and what it can do right now, so the app shows only what works
    // (web/src/data/server.ts). Public: it says nothing about the user.
    "/api/server": { GET: () => json({ release: config.release, minClientVersion: config.minClientVersion, features: { ai: ai.enabled } }, 200, { "cache-control": "no-cache" }) },

    "/api/shape": { GET: async (req) => proxyShape(req, (await requireUser(req)).id, config) },
    "/api/write": {
      POST: async (req) => {
        requireFreshClient(req);
        return handleWrite(req, sql, (await requireUser(req)).id);
      },
    },

    "/api/me": {
      GET: async (req) => {
        const user = await requireUser(req);
        return json({ id: user.id, email: user.isAnonymous ? null : user.email, anonymous: !!user.isAnonymous, credits: await ai.credits(user.id), ai: ai.enabled });
      },
    },
    "/api/ai/mine": { POST: async (req) => json(await ai.mine((await requireUser(req, { real: true })).id, await body(req, MineIn))) },
    "/api/ai/examples": { POST: async (req) => json(await ai.examples((await requireUser(req, { real: true })).id, await body(req, ExamplesIn))) },

    "/api/account/delete": {
      POST: async (req) => {
        const user = await requireUser(req);
        // Everything the learner has cascades from the user row.
        await sql`delete from "user" where id = ${user.id}`;
        event({ accountDeleted: true });
        return json({ ok: true });
      },
    },
  };

  if (config.dev && mailer instanceof OutboxMailer) {
    // Lets tests and local development read sign-in codes. Never mounted in production.
    routes["/api/dev/outbox"] = {
      GET: (req) => {
        const email = new URL(req.url).searchParams.get("email") ?? "";
        const m = mailer.latest(email);
        return m ? json({ code: m.subject.match(/\d{6}/)?.[0], subject: m.subject }) : fail(404, "no_mail");
      },
    };
    // The signed-in learner's rows, as stored on the server (tests check what really arrived).
    routes["/api/dev/rows"] = {
      GET: async (req) => {
        const user = await requireUser(req);
        const table = new URL(req.url).searchParams.get("table");
        if (!table || !LEARNER_TABLES.includes(table)) throw new HttpError(400, "unknown_table");
        return json(await sql`select * from ${sql(table)} where user_id = ${user.id}`);
      },
    };
  }

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
  function requireSameOrigin(req: Request) {
    const origin = req.headers.get("origin");
    const site = req.headers.get("sec-fetch-site");
    if (origin ? origin !== appOrigin : site !== null && site !== "same-origin") throw new HttpError(403, "cross_origin");
    if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) throw new HttpError(415, "json_only");
  }

  async function route(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/auth/")) return authEndpoints[url.pathname]?.includes(req.method) ? auth.handler(req) : fail(404, "not_found");
    if (req.method !== "GET" && req.method !== "HEAD" && url.pathname.startsWith("/api/")) requireSameOrigin(req);
    const r = routes[url.pathname];
    if (r) {
      const h = r[req.method];
      return h ? h(req) : fail(405, "method_not_allowed");
    }
    if (url.pathname.startsWith("/api/")) return fail(404, "not_found");
    if (req.method !== "GET" && req.method !== "HEAD") return fail(405, "method_not_allowed");
    return serveStatic(config.staticDir, url.pathname);
  }

  // Other names for the app send people to the one in APP_URL (sign-in works
  // only there): www, and Railway's own domain once a custom domain is set.
  const appHost = new URL(config.appUrl).host;
  const isAlias = (host: string) => host !== appHost && (host === `www.${appHost}` || host.endsWith(".up.railway.app"));

  async function fetch(incoming: Request): Promise<Response> {
    const req = withClientIp(incoming, config.clientIpHeaders);
    const id = req.headers.get("x-request-id")?.slice(0, 64) || crypto.randomUUID();
    const url = new URL(req.url);
    // A browser that still has the old worker asks for /sw.js to update it: here, or
    // on an old address, where that worker serves the page from cache (so the redirect
    // below never reaches it). Not a redirect: a worker script that redirects fails
    // the update. no-cache: a CDN must not keep it.
    if (url.pathname === "/sw.js") return new Response(retiringWorker(config.appUrl), { headers: { "content-type": "text/javascript", "cache-control": "no-cache" } });
    if (isAlias(url.host)) return new Response(null, { status: 308, headers: { location: config.appUrl + url.pathname + url.search } });
    const started = performance.now();
    return withLogContext({ reqId: id, traceId: traceId() }, async () => {
      let res: Response;
      try {
        res = await route(req);
      } catch (e) {
        if (e instanceof HttpError) {
          res = fail(e.status, e.code, e.extra);
          // The rest of a too-large body is never read: close the connection so
          // the client does not send its next request down the broken socket.
          if (e.status === 413) res.headers.set("connection", "close");
        }
        else {
          log.error("unhandled error", { err: e, path: url.pathname });
          Sentry.withScope((scope) => {
            scope.setTag("request_id", id);
            Sentry.captureException(e);
          });
          res = fail(500, "internal_error", { requestId: id });
        }
      }
      // Shapes are long polls (held open until data changes, then cancelled by
      // the browser as 499): logging them would drown everything else.
      const ms = Math.round(performance.now() - started);
      if (url.pathname !== "/api/shape" || (res.status >= 400 && res.status !== 499)) {
        // Slow requests stand out (warn) so they can be searched and alerted on. Live shape
        // polls wait ~20 s by design and AI calls take seconds, so neither counts.
        const slow = ms > SLOW_MS && url.pathname !== "/api/shape" && !url.pathname.startsWith("/api/ai/");
        (slow ? log.warn : log.info)(slow ? "slow request" : "request", { method: req.method, path: url.pathname, status: res.status, ms });
        // Grouped by route: API paths carry no ids; every static file is one route.
        if (slow && ms > VERY_SLOW_MS) reportVerySlow(req.method, url.pathname.startsWith("/api/") ? url.pathname : "static", res.status, ms);
      }
      const out = new Response(res.body, res);
      out.headers.set("x-request-id", id);
      // API answers are per user and live: a CDN in front must never keep them.
      if (url.pathname.startsWith("/api/") && !out.headers.has("cache-control")) out.headers.set("cache-control", "no-store");
      for (const [k, v] of Object.entries(headers)) if (!out.headers.has(k)) out.headers.set(k, v);
      return out;
    });
  }

  return { fetch, auth, ai, mailer, close: () => pool.end() };
}
