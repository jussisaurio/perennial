// Test harness: the real app against the local Postgres + Electric
// (`docker compose up -d`), with a mock model and the dev mail outbox.

import { Context, Effect, Exit, Layer, Logger, Scope } from "effect";
import { HttpEffect, HttpServer, HttpServerRequest } from "effect/http";
import { App, AppLive, BunServerLive, HttpLive } from "../src/app";
import { AppConfig, loadConfig, type Config } from "../src/config";
import { logger } from "../src/log";
import { OutboxMailer } from "../src/mail";
import { migrate } from "../src/migrate";
import { Ai, Auth, Database, Mail, ServicesLive } from "../src/services";

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

export const unique = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}@example.com`;

export async function startApp(overrides: Partial<Config> = {}) {
  const config = loadConfig({ dev: true, anthropic: { apiKey: "test-key", baseURL: await mockLLM(), model: "claude-haiku-4-5" }, ...overrides });
  const sql = new Bun.SQL(config.databaseUrl, { max: 5 });
  await migrate(sql);
  // The server as index.ts runs it (Effect's Bun server), with these settings and this pool.
  const layer = HttpLive.pipe(
    Layer.provideMerge(AppLive),
    Layer.provideMerge(BunServerLive(0)),
    Layer.provideMerge(ServicesLive),
    Layer.provideMerge(Layer.succeed(Database, sql)),
    Layer.provideMerge(Layer.succeed(AppConfig, config)),
    Layer.provideMerge(Logger.layer([logger])),
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

  /** A request as the browser would send it: same-origin, with the session cookie. */
  const call = async (path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}) => {
    const res = await fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", origin: config.appUrl, ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
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
    const set = res.headers.getSetCookie().map((c) => c.split(";")[0]).filter((c) => !c.endsWith("="));
    if (!set.length) return previous;
    const jar = new Map((previous ?? "").split("; ").filter(Boolean).map((c) => [c.split("=")[0], c] as const));
    for (const c of set) jar.set(c.split("=")[0], c);
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
    sql,
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
      await sql.close();
    },
  };
}

/** Real Spanish deck word ids (writes refuse made-up ones), by short name: W.a, W.b, … */
const ES_IDS = (JSON.parse(await Bun.file(new URL("../../decks/es/deck.json", import.meta.url)).text()) as { words: { id: string }[] }).words.map((w) => w.id);
export const W = Object.fromEntries("abcdefghijklm".split("").map((k, i) => [k, ES_IDS[i]])) as Record<string, string>;

export const review = (wordId: string, extra: Record<string, unknown> = {}) => ({
  type: "review.insert",
  row: { id: crypto.randomUUID(), lang: "es", word_id: wordId, skill: "read", grade: 3, reviewed_at: new Date().toISOString(), duration_ms: 4000, ...extra },
});
