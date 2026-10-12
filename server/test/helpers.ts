// Test harness: the real app against the local Postgres + Electric
// (`docker compose up -d`), with a mock model and the dev mail outbox.

import { createApp } from "../src/app";
import { loadConfig, type Config } from "../src/config";
import { migrate } from "../src/migrate";
import type { OutboxMailer } from "../src/mail";

process.env.LOG_LEVEL ??= "silent";

let mockPort = 0;
let mockProc: ReturnType<typeof Bun.spawn> | null = null;

/** One mock LLM process per test file. */
export async function mockLLM(): Promise<string> {
  if (!mockProc) {
    mockPort = 20000 + Math.floor(Math.random() * 20000);
    mockProc = Bun.spawn(["bun", "mock-llm.ts"], { cwd: `${import.meta.dir}/..`, env: { ...process.env, PORT: String(mockPort) }, stdout: "ignore" });
    // Wait for it to listen (up to 2.5 s); a mock that never starts fails the first AI test.
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(`http://localhost:${mockPort}/v1/messages`, { method: "OPTIONS" });
        break;
      } catch {
        await Bun.sleep(50);
      }
    }
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
  const app = createApp(config, sql);
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  const url = `http://localhost:${server.port}`;
  const mailer = app.mailer as OutboxMailer;

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
      server.stop(true);
      await app.close();
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
