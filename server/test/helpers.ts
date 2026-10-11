import { rmSync } from "node:fs";
import { createApp } from "../src/app";
import { loadConfig, type Config } from "../src/config";
import { OutboxMailer } from "../src/mail";

let mockPort = 0;
let mockProc: ReturnType<typeof Bun.spawn> | null = null;

/** One mock LLM process per test file. */
export async function mockLLM(): Promise<string> {
  if (!mockProc) {
    mockPort = 20000 + Math.floor(Math.random() * 20000);
    mockProc = Bun.spawn(["bun", "mock-llm.ts"], { cwd: `${import.meta.dir}/..`, env: { ...process.env, PORT: String(mockPort) }, stdout: "ignore" });
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

export async function startApp(overrides: Partial<Config> = {}) {
  const dbPath = `/tmp/perennial-test-${process.pid}-${Math.random().toString(36).slice(2)}.db`;
  const base = loadConfig();
  const config = loadConfig({
    dbPath,
    dev: true,
    anthropic: { apiKey: "test-key", baseURL: await mockLLM(), model: "claude-haiku-4-5" },
    stripe: {},
    ...overrides,
  });
  void base;
  const mailer = new OutboxMailer();
  const app = createApp(config, { mailer });
  const server = Bun.serve({ port: 0, fetch: app.fetch });
  const url = `http://localhost:${server.port}`;
  const call = async (path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const res = await fetch(url + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Session ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  };
  const signIn = async (email: string) => {
    await call("/api/auth/code", { email });
    const code = mailer.latest(email)!.subject.match(/\d{6}/)![0];
    const r = await call("/api/auth/verify", { email, code });
    return r.body.token as string;
  };
  return {
    app,
    url,
    call,
    signIn,
    mailer,
    stop() {
      server.stop(true);
      rmSync(dbPath, { force: true });
      rmSync(`${dbPath}-wal`, { force: true });
      rmSync(`${dbPath}-shm`, { force: true });
    },
  };
}
