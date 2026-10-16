// Test harness: the real app against the local Postgres + Electric
// (`docker compose up -d`), with a mock model and the dev mail outbox.

import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { HttpEffect, HttpServer, HttpServerRequest } from "effect/http";
import { Reactivity } from "effect/reactivity";
import type { Row } from "effect/sql/SqlConnection";
import { Ai } from "../src/ai";
import { App, AppLive, BunServerLive, HttpLive } from "../src/app";
import { AppConfig, loadConfig, type Config } from "../src/config";
import { connection as connectTo, DatabaseLive } from "../src/db";
import { LoggerLive } from "../src/log";
import { Mail, OutboxMailer } from "../src/mail";
import { Migrations, MigrationsLive } from "../src/migrate";
import { Auth, ServicesLive } from "../src/services";

process.env.LOG_LEVEL ??= "silent";

let mockPort = 0;
let mockProc: ReturnType<typeof Bun.spawn> | null = null;

/** One mock LLM process per test file. */
export async function mockLLM(): Promise<string> {
  if (!mockProc) {
    // Port 0: the system picks a free one, and the mock prints it once it listens.
    // (A random port could be taken: CI once failed with "Is port 34900 in use?".)
    const proc = Bun.spawn(["bun", "mock-llm.ts"], { cwd: `${import.meta.dir}/..`, env: { ...process.env, PORT: "0" }, stdout: "pipe" });
    mockProc = proc;
    const port = await Promise.race([
      (async () => {
        let text = "";
        for await (const chunk of proc.stdout) {
          text += new TextDecoder().decode(chunk);
          const m = text.match(/localhost:(\d+)/);
          if (m) return Number(m[1]);
        }
        return null; // the mock exited before listening
      })(),
      Bun.sleep(5000).then(() => null),
    ]);
    // A mock that never starts says so here, not later as a puzzling AI test failure.
    if (!port) throw new Error("mock LLM did not start within 5 s");
    mockPort = port;
  }
  return `http://localhost:${mockPort}`;
}

export function stopMockLLM() {
  mockProc?.kill();
  mockProc = null;
}

/** The text before the first `sep` (all of it if there is none): a cookie's name=value, a name. */
export const before = (text: string, sep: string) => (text.includes(sep) ? text.slice(0, text.indexOf(sep)) : text);

export const unique = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}@example.com`;

export async function startApp(overrides: Partial<Config> = {}) {
  const config = loadConfig({ dev: true, anthropic: { apiKey: "test-key", baseURL: await mockLLM(), model: "claude-haiku-4-5" }, ...overrides });
  // The server as index.ts runs it (Effect's Bun server), with these settings.
  const layer = HttpLive.pipe(
    Layer.provideMerge(BunServerLive(0)),
    Layer.provideMerge(AppLive),
    Layer.provideMerge(ServicesLive),
    // Before the services: Better Auth checks its tables when it starts (production migrates before each deploy).
    Layer.provideMerge(Layer.effectDiscard(Effect.flatMap(Migrations, (m) => m.run())).pipe(Layer.provide(MigrationsLive))),
    Layer.provideMerge(DatabaseLive),
    Layer.provideMerge(Layer.succeed(AppConfig, config)),
    Layer.provideMerge(LoggerLive),
  );
  const scope = Effect.runSync(Scope.make());
  const context = await Effect.runPromise(Layer.buildWithScope(layer, scope));
  const address = Context.get(context, HttpServer.HttpServer).address;
  if (address._tag === "UnixPathAddress") throw new Error("the test server listens on a port");
  const url = `http://localhost:${address.port}`;
  const mailer = Context.get(context, Mail);
  if (!(mailer instanceof OutboxMailer)) throw new Error("tests read sign-in codes from the dev outbox");
  /** The app's parts that tests reach into, and a fetch that skips the network (no client IP, no abort). */
  const app = { fetch: HttpEffect.toWebHandlerWith<Layer.Success<typeof layer>, HttpServerRequest.HttpServerRequest | Scope.Scope>(context)(Context.get(context, App).handle), auth: Context.get(context, Auth), ai: Context.get(context, Ai) };

  /** The app's pool, for test queries: t.sql`select …` is a promise of rows; t.db makes identifiers (t.db(table)) and lists (t.db.in(ids)). */
  const db = Context.get(context, PgClient.PgClient);
  const sql = <A extends object = Row>(strings: TemplateStringsArray, ...args: unknown[]) => Effect.runPromise(db<A>(strings, ...args));

  /** A connection of its own, for a test that holds a lock or a transaction open meanwhile. */
  const connection = async () => {
    const held = Effect.runSync(Scope.make());
    const client = await Effect.runPromise(PgClient.makeClient(connectTo(config.databaseUrl)).pipe(Effect.provide(Reactivity.layer), Scope.provide(held)));
    return {
      sql: <A extends object = Row>(strings: TemplateStringsArray, ...args: unknown[]) => Effect.runPromise(client<A>(strings, ...args)),
      close: () => Effect.runPromise(Scope.close(held, Exit.void)),
    };
  };

  /** A request as the browser would send it: same-origin, with the session cookie. */
  const call = async (path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}) => {
    const res = await fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", origin: config.appUrl, ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? null : JSON.stringify(body),
    });
    const text = await res.text();
    // Tests read whatever JSON a route returns.
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed, headers: res.headers, cookie: cookieOf(res, cookie) };
  };

  /** Keep the session cookie the server sets (or the one we already had). */
  function cookieOf(res: Response, previous?: string) {
    const set = res.headers.getSetCookie().map((c) => before(c, ";")).filter((c) => !c.endsWith("="));
    if (!set.length) return previous;
    const jar = new Map((previous ?? "").split("; ").filter(Boolean).map((c) => [c.split("=")[0], c] as const));
    for (const c of set) jar.set(before(c, "="), c);
    return [...jar.values()].join("; ");
  }

  const sendCode = (email: string, cookie?: string) => call("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" }, cookie);
  /** The sign-in code in the latest email to this address. */
  const codeFor = (email: string) => mailer.latest(email)!.subject.match(/\d{6}/)![0];
  const signIn = async (email: string, cookie?: string) => {
    const sent = await sendCode(email, cookie);
    if (sent.status !== 200) throw new Error(`send code: ${sent.status} ${JSON.stringify(sent.body)}`);
    const r = await call("/api/auth/sign-in/email-otp", { email, otp: codeFor(email) }, cookie);
    if (r.status !== 200) throw new Error(`sign in: ${r.status} ${JSON.stringify(r.body)}`);
    return r.cookie!;
  };
  const anonymous = async () => {
    const r = await call("/api/auth/sign-in/anonymous", {});
    if (r.status !== 200) throw new Error(`anonymous: ${r.status} ${JSON.stringify(r.body)}`);
    return r.cookie!;
  };
  const write = (cookie: string, mutations: unknown[]) => call("/api/write", { mutations }, cookie);
  const me = async (cookie: string) => (await call("/api/me", undefined, cookie)).body as { id: string; email: string | null; anonymous: boolean; credits: { used: number; left: number } };

  return {
    app,
    config,
    db,
    sql,
    connection,
    url,
    call,
    sendCode,
    codeFor,
    signIn,
    anonymous,
    write,
    me,
    mailer,
    async stop() {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
}

/** Real Spanish deck word ids (writes refuse made-up ones), by short name: W.a, W.b, … */
const ES_IDS = (JSON.parse(await Bun.file(new URL("../../decks/es/deck.json", import.meta.url)).text()) as { words: { id: string }[] }).words.map((w) => w.id);
/** The i-th of the 13 deck words below, wrapping around. */
export const word = (i: number) => {
  const id = ES_IDS[i % 13];
  if (id === undefined) throw new Error("the Spanish deck has fewer than 13 words");
  return id;
};
export const W = { a: word(0), b: word(1), c: word(2), d: word(3), e: word(4), f: word(5), g: word(6), h: word(7), i: word(8), j: word(9), k: word(10), l: word(11), m: word(12) };

export const review = (wordId: string, extra: Record<string, unknown> = {}) => ({
  type: "review.insert",
  row: { id: crypto.randomUUID(), lang: "es", word_id: wordId, skill: "read", grade: 3, reviewed_at: new Date().toISOString(), duration_ms: 4000, ...extra },
});
