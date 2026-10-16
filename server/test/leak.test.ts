// Many learners at once, on the server as production runs it (instrument.ts
// preloaded, every request traced): each request's log line and Sentry
// transaction carry only its own facts, and its spans hang under its own root.
//
// This is what explicit Sentry parents are for (request.ts inSentryScope,
// sentrySpan; model.ts). Sentry finds the "active span" in AsyncLocalStorage,
// and a fiber waiting for a pooled connection resumes in the callback of the
// fiber that released it: another request's. With the parents left to
// AsyncLocalStorage, "ai mine" spans land in other requests' transactions here.

import { afterAll, expect, test } from "bun:test";
import { gunzipSync } from "bun";
import { mockLLM, review, stopMockLLM, unique, W } from "./helpers";

type Span = { span_id: string; parent_span_id?: string; trace_id: string; op?: string; description?: string; data?: Record<string, unknown> };
type Transaction = { transaction: string; contexts: { trace: Span }; spans: Span[] };
type Line = Record<string, unknown>;

/** A stand-in for Sentry's ingest: it keeps the transactions it is sent. */
const transactions: Transaction[] = [];
const ingest = Bun.serve({
  port: 0,
  async fetch(req) {
    const raw = new Uint8Array(await req.arrayBuffer());
    const lines = new TextDecoder().decode(req.headers.get("content-encoding") === "gzip" ? gunzipSync(raw) : raw).split("\n");
    for (let i = 1; i + 1 < lines.length; i += 2) if (JSON.parse(lines[i] ?? "{}").type === "transaction") transactions.push(JSON.parse(lines[i + 1] ?? "{}"));
    return new Response("{}");
  },
});

/** A slow, uneven model: AI calls finish in a different order than they start. */
const mock = await mockLLM();
const model = Bun.serve({
  port: 0,
  async fetch(req) {
    await Bun.sleep(Math.random() * 300);
    const url = new URL(req.url);
    return fetch(mock + url.pathname + url.search, { method: req.method, headers: req.headers, body: await req.arrayBuffer() });
  },
});

const lines: Line[] = [];
const server = Bun.spawn(["bun", "--preload", "./instrument.ts", "index.ts"], {
  cwd: `${import.meta.dir}/..`,
  env: {
    ...process.env,
    SENTRY_DSN: `http://public@localhost:${ingest.port}/1`,
    SENTRY_TRACES_SAMPLE_RATE: "1",
    PORT: "0",
    PERENNIAL_DEV: "1",
    LOG_LEVEL: "info",
    ANTHROPIC_API_KEY: "test-key",
    ANTHROPIC_BASE_URL: `http://localhost:${model.port}`,
    // Many AI calls per learner: neither limit is under test here.
    AI_RPM: "100000",
    FREE_CREDITS: "100000",
  },
  stdout: "pipe",
  stderr: "pipe",
});
afterAll(() => (server.kill(), ingest.stop(true), model.stop(true), stopMockLLM()));

/** Keep every JSON line the server prints. */
async function collect(stream: ReadableStream<Uint8Array>) {
  let buffer = "";
  for await (const chunk of stream) {
    buffer += new TextDecoder().decode(chunk);
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) if (line.startsWith("{")) lines.push(JSON.parse(line)); // not the [mail] lines
  }
}
void collect(server.stdout);
void collect(server.stderr);

async function until(check: () => boolean) {
  while (!check()) await Bun.sleep(20);
}
await until(() => lines.some((l) => l.msg === "perennial server started"));
const url = String(lines.find((l) => l.msg === "perennial server started")?.url);

/** A request with its own id, sent at a slightly random time. */
async function send(path: string, rid: string, body?: unknown, cookie?: string) {
  await Bun.sleep(Math.random() * 30);
  const res = await fetch(url + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:5173", "x-request-id": rid, ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.getSetCookie().map((c) => c.split(";")[0] ?? "").filter((c) => !c.endsWith("="));
  return { res, cookie: set.length ? set.join("; ") : cookie };
}

test("no request's facts or spans land on another request's line or trace", async () => {
  /** What each request's line must say, by request id. */
  const expected = new Map<string, Line>();
  let n = 0;
  const rid = (tag: string) => `${tag}-${++n}`;
  const userOf = async (res: Response) => ((await res.json()) as { user: { id: string } }).user.id;

  const learner = async (i: number) => {
    const r0 = rid("anon");
    const anon = await send("/api/auth/sign-in/anonymous", r0, {});
    const anonId = await userOf(anon.res);
    expected.set(r0, { userId: anonId, signup: "anonymous", signin: "anonymous" });
    for (let k = 0; k < 3; k++) {
      const writes = (i % 5) + 1 + k;
      const r = rid("write");
      const out = await send("/api/write", r, { mutations: Array.from({ length: writes }, (_, j) => review(Object.values(W)[j % 13] ?? "")) }, anon.cookie);
      expect(out.res.status).toBe(200);
      expected.set(r, { userId: anonId, writes });
    }
    const email = unique(`leak${i}`);
    const r1 = rid("otp");
    await send("/api/auth/email-otp/send-verification-otp", r1, { email, type: "sign-in" }, anon.cookie);
    expected.set(r1, { otp: "sent" });
    const { code } = (await (await fetch(`${url}/api/dev/outbox?email=${encodeURIComponent(email)}`)).json()) as { code: string };
    const r2 = rid("signin");
    const signedIn = await send("/api/auth/sign-in/email-otp", r2, { email, otp: code }, anon.cookie);
    const realId = await userOf(signedIn.res);
    expected.set(r2, { userId: realId, signin: "email", signup: "email" });
    const ai = await Promise.all(
      [0, 1].map(async () => {
        const r = rid("mine");
        const mined = await send("/api/ai/mine", r, { lang: "es", items: [{ form: `zorro${i}`, sentence: "Veo un zorro." }], known: [] }, signedIn.cookie);
        expected.set(r, { userId: realId, aiTask: "mine" });
        return mined.res.status;
      }),
    );
    expect(ai).toEqual([200, 200]);
    const r3 = rid("me");
    expect((await send("/api/me", r3, undefined, signedIn.cookie)).res.status).toBe(200);
    expected.set(r3, { userId: realId });
    const r4 = rid("del");
    expect((await send("/api/account/delete", r4, {}, signedIn.cookie)).res.status).toBe(200);
    expected.set(r4, { userId: realId, accountDeleted: true });
  };
  await Promise.all(Array.from({ length: 40 }, (_, i) => learner(i)));

  const requestLine = (r: string) => lines.find((l) => l.reqId === r && l.msg === "request");
  await until(() => [...expected.keys()].every((r) => requestLine(r) && transactions.some((t) => t.contexts.trace.trace_id === requestLine(r)?.traceId)));
  for (const [r, facts] of expected) {
    const line = requestLine(r);
    for (const [k, v] of Object.entries(facts)) expect({ r, k, v: line?.[k] }).toEqual({ r, k, v });
    const tx = transactions.find((t) => t.contexts.trace.trace_id === line?.traceId);
    const root = tx?.contexts.trace.span_id;
    for (const [k, v] of Object.entries(facts)) if (k !== "userId") expect({ r, k, v: tx?.contexts.trace.data?.[k] }).toEqual({ r, k, v });
    if (facts.writes) {
      const batch = tx?.spans.find((s) => s.description === "write batch");
      expect({ r, mutations: batch?.data?.mutations, parent: batch?.parent_span_id }).toEqual({ r, mutations: facts.writes, parent: root });
    }
    if (facts.aiTask) {
      const ai = tx?.spans.find((s) => s.description === "ai mine");
      expect({ r, parent: ai?.parent_span_id }).toEqual({ r, parent: root });
      expect({ r, modelCall: tx?.spans.some((s) => s.op === "http.client" && s.parent_span_id === ai?.span_id) }).toEqual({ r, modelCall: true });
    }
  }
  // One trace per request line.
  const traced = lines.filter((l) => l.msg === "request" && l.traceId);
  expect(new Set(traced.map((l) => l.traceId)).size).toBe(traced.length);
}, 120_000);
