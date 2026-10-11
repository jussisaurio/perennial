import type Anthropic from "@anthropic-ai/sdk";
import { join } from "node:path";
import { z } from "zod";
import { AIError, AIService, CourseBatchIn, ExamplesIn, MineIn } from "./ai";
import { Auth, AuthError, type User } from "./auth";
import { Billing, BillingError } from "./billing";
import type { Config } from "./config";
import { compact } from "./compact";
import { openDb } from "./db";
import { createMailer, OutboxMailer, type Mailer } from "./mail";

const PAGE = 2000;
const MAX_BODY = 20 * 1024 * 1024;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => json({ error, ...extra }, status);

export function createApp(config: Config, deps: { anthropic?: Anthropic; mailer?: Mailer } = {}) {
  const db = openDb(config.dbPath);
  const mailer = deps.mailer ?? createMailer(config);
  const auth = new Auth(db, config, mailer);
  const ai = new AIService(db, config, deps.anthropic);
  const billing = new Billing(db, config);

  const insert = db.prepare("INSERT OR IGNORE INTO ops (ns, id, body) VALUES ($ns, $id, $body)");
  const since = db.prepare<{ seq: number; body: string }, { ns: string; cursor: number; limit: number }>(
    "SELECT seq, body FROM ops WHERE ns = $ns AND seq > $cursor ORDER BY seq LIMIT $limit",
  );
  const pushAll = db.transaction((ns: string, ops: { id: string }[]) => {
    for (const op of ops) insert.run({ ns, id: op.id, body: JSON.stringify(op) });
  });

  const isOp = (x: unknown): x is { id: string } => {
    const o = x as Record<string, unknown>;
    return !!o && typeof o.id === "string" && typeof o.hlc === "string" && typeof o.table === "string" && typeof o.rowId === "string";
  };

  /** Data syncs only under a signed-in account. */
  function syncNamespace(req: Request): string | null {
    const user = auth.authenticate(req);
    return user ? `user:${user.id}` : null;
  }

  async function handleSync(req: Request): Promise<Response> {
    const ns = syncNamespace(req);
    if (!ns) return fail(401, "sign in to sync");
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return fail(413, "body too large");
    const body = (await req.json().catch(() => null)) as { cursor?: number; ops?: unknown[] } | null;
    if (!body || !Array.isArray(body.ops) || !body.ops.every(isOp)) return fail(400, "bad request");
    pushAll(ns, body.ops);
    const rows = since.all({ ns, cursor: Number(body.cursor) || 0, limit: PAGE + 1 });
    const page = rows.slice(0, PAGE);
    return json({ ops: page.map((r) => JSON.parse(r.body)), cursor: page.length ? page[page.length - 1].seq : Number(body.cursor) || 0, more: rows.length > PAGE });
  }

  const me = (user: User) => ({
    email: user.email,
    plan: user.plan,
    subscription: user.sub_status ? { status: user.sub_status, periodEnd: user.sub_period_end } : null,
    credits: ai.credits(user),
    billing: billing.stripe ? { monthly: config.stripe.labelMonthly ?? null, yearly: config.stripe.labelYearly ?? null } : null,
    plans: { free: config.plans.free.credits, pro: config.plans.pro.credits },
  });

  /** Wrap a handler: parse JSON input, require a session, map domain errors to HTTP. */
  function route<S extends z.ZodType>(schema: S | null, fn: (user: User, input: z.infer<S>, req: Request) => Promise<unknown> | unknown, opts: { auth?: boolean } = { auth: true }) {
    return async (req: Request): Promise<Response> => {
      try {
        const user = auth.authenticate(req);
        if (opts.auth !== false && !user) return fail(401, "sign_in_required");
        let input: unknown = undefined;
        if (schema) {
          const parsed = schema.safeParse(await req.json().catch(() => undefined));
          if (!parsed.success) return fail(400, "bad_request", { issues: parsed.error.issues.slice(0, 5) });
          input = parsed.data;
        }
        return json(await fn(user as User, input as z.infer<S>, req));
      } catch (e) {
        if (e instanceof AuthError || e instanceof BillingError) return fail(e.status, e.code);
        if (e instanceof AIError) return fail(e.status, e.code, e.detail ?? {});
        console.error(e);
        return fail(500, "server_error");
      }
    };
  }

  async function serveStatic(path: string): Promise<Response> {
    const file = Bun.file(join(config.staticDir, path === "/" ? "index.html" : path.replace(/\.\.+/g, "")));
    if (await file.exists()) return new Response(file);
    const index = Bun.file(join(config.staticDir, "index.html"));
    return (await index.exists()) ? new Response(index) : new Response("not found", { status: 404 });
  }

  const routes: Record<string, Record<string, (req: Request) => Promise<Response> | Response>> = {
    "/health": { GET: () => new Response("ok") },
    "/sync": { POST: handleSync },
    "/api/sync": { POST: handleSync },

    "/api/auth/code": {
      POST: route(z.object({ email: z.string() }), async (_u, { email }) => {
        await auth.requestCode(email);
        return { ok: true };
      }, { auth: false }),
    },
    "/api/auth/verify": {
      POST: route(z.object({ email: z.string(), code: z.string() }), (_u, { email, code }) => {
        const { token, user } = auth.verifyCode(email, code);
        return { token, me: me(user) };
      }, { auth: false }),
    },
    "/api/auth/signout": { POST: route(null, (_u, _i, req) => (auth.signOut(req), { ok: true })) },
    "/api/me": { GET: route(null, (user) => me(user)) },
    "/api/account/delete": {
      POST: route(z.object({ confirm: z.literal("delete") }), (user) => {
        // Never leave a paid subscription running for an account that no longer exists.
        if (user.plan === "pro") throw new AuthError(409, "cancel_subscription_first");
        auth.deleteAccount(user);
        return { ok: true };
      }),
    },

    "/api/ai/course-batch": { POST: route(CourseBatchIn, (user, input) => ai.courseBatch(user, input)) },
    "/api/ai/mine": { POST: route(MineIn, (user, input) => ai.mine(user, input)) },
    "/api/ai/examples": { POST: route(ExamplesIn, (user, input) => ai.examples(user, input)) },

    "/api/billing/checkout": { POST: route(z.object({ interval: z.enum(["month", "year"]) }), async (user, { interval }) => ({ url: await billing.checkout(user, interval) })) },
    "/api/billing/portal": { POST: route(null, async (user) => ({ url: await billing.portal(user) })) },
    "/api/billing/webhook": {
      POST: async (req) => {
        try {
          const type = await billing.webhook(await req.text(), req.headers.get("stripe-signature"));
          return json({ received: type });
        } catch (e) {
          if (e instanceof BillingError) return fail(e.status, e.code);
          console.error(e);
          return fail(500, "server_error");
        }
      },
    },
  };

  if (config.dev && mailer instanceof OutboxMailer) {
    // Lets tests and local development read sign-in codes. Never mounted in production.
    routes["/api/dev/outbox"] = {
      GET: (req) => {
        const to = new URL(req.url).searchParams.get("email")?.toLowerCase() ?? "";
        const m = mailer.latest(to);
        return m ? json({ ...m, code: m.subject.match(/\d{6}/)?.[0] }) : fail(404, "no_mail");
      },
    };
    // Lets end-to-end tests send a correctly signed webhook for a user.
    routes["/api/dev/user"] = {
      GET: (req) => {
        const u = auth.userByEmail(new URL(req.url).searchParams.get("email")?.toLowerCase() ?? "");
        return u ? json(u) : fail(404, "no_user");
      },
    };
  }

  async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const handlers = routes[url.pathname];
    if (handlers) {
      const h = handlers[req.method];
      return h ? h(req) : fail(405, "method_not_allowed");
    }
    if (url.pathname.startsWith("/api/")) return fail(404, "not_found");
    return serveStatic(url.pathname);
  }

  /** Daily housekeeping: forget long-deleted data, expire sessions and codes. */
  function maintain(now = Date.now()) {
    return { ...compact(db, now), ...auth.purgeExpired(now) };
  }

  return { fetch, db, auth, ai, billing, mailer, maintain };
}
