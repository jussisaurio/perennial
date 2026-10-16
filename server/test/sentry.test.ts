// Traces: the server as it runs in production (instrument.ts preloaded), sending
// to a stand-in Sentry. A request's trace carries its wide-event facts, and the
// "write batch" and "ai …" spans hang under it, with the model's HTTP call under
// "ai mine"; the request's log line names the same trace. A server that can't
// start says why, there too.

import { afterAll, expect, test } from "bun:test";
import { gunzipSync } from "bun";
import { before, mockLLM, review, stopMockLLM, unique, W, word } from "./helpers";

type Span = { span_id: string; parent_span_id?: string; trace_id: string; op?: string; description?: string; data?: Record<string, unknown> };
type Transaction = { transaction: string; contexts: { trace: Span }; spans: Span[] };
type ErrorEvent = { exception?: { values?: { type?: string; value?: string }[] } };

/** A stand-in for Sentry's ingest: it keeps the transactions and error events it is sent. */
const transactions: Transaction[] = [];
const errors: ErrorEvent[] = [];
const ingest = Bun.serve({
  port: 0,
  async fetch(req) {
    const raw = new Uint8Array(await req.arrayBuffer());
    const text = new TextDecoder().decode(req.headers.get("content-encoding") === "gzip" ? gunzipSync(raw) : raw);
    // An envelope: its own header line, then a header and a payload line per item.
    const lines = text.split("\n").slice(1);
    for (const [i, header] of lines.entries()) {
      const payload = lines[i + 1];
      if (i % 2 || payload === undefined) continue;
      const type = JSON.parse(header).type;
      if (type === "transaction") transactions.push(JSON.parse(payload));
      if (type === "event") errors.push(JSON.parse(payload));
    }
    return new Response("{}");
  },
});

const env = {
  ...process.env,
  SENTRY_DSN: `http://public@localhost:${ingest.port}/1`,
  SENTRY_TRACES_SAMPLE_RATE: "1",
  PORT: "0",
  PERENNIAL_DEV: "1",
  LOG_LEVEL: "info",
  ANTHROPIC_API_KEY: "test-key",
  ANTHROPIC_BASE_URL: await mockLLM(),
};
/** The server as production starts it. */
const start = (extra: Record<string, string> = {}) =>
  Bun.spawn(["bun", "--preload", "./instrument.ts", "index.ts"], { cwd: `${import.meta.dir}/..`, env: { ...env, ...extra }, stdout: "pipe", stderr: "pipe" });

const logLines: Record<string, unknown>[] = [];
const server = start();
afterAll(() => (server.kill(), ingest.stop(true), stopMockLLM()));

/** The server's URL, from its start line; then every JSON line it prints, kept. */
const url = await new Promise<string>((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("the server did not start within 10 s")), 10_000);
  (async () => {
    let buffer = "";
    for await (const chunk of server.stdout) {
      buffer += new TextDecoder().decode(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("{")) continue; // [mail] lines from the dev outbox
        const parsed = JSON.parse(line);
        logLines.push(parsed);
        if (parsed.msg === "perennial server started") {
          clearTimeout(timer);
          resolve(String(parsed.url));
        }
      }
    }
  })();
});

const post = async (path: string, body: unknown, cookie?: string) => {
  const res = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:5173", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const set = res.headers.getSetCookie().map((c) => before(c, ";")).filter((c) => !c.endsWith("="));
  return { res, cookie: set.length ? set.join("; ") : cookie };
};

async function transactionFor(name: string) {
  for (;;) {
    const found = transactions.find((t) => t.transaction === name);
    if (found) return found;
    await Bun.sleep(50);
  }
}

test("a request's trace has its facts and its spans", async () => {
  const email = unique("traced");
  const { cookie: anon } = await post("/api/auth/sign-in/anonymous", {});
  expect((await post("/api/write", { mutations: [review(W.a)] }, anon)).res.status).toBe(200);
  await post("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" }, anon);
  const { code } = (await (await fetch(`${url}/api/dev/outbox?email=${encodeURIComponent(email)}`)).json()) as { code: string };
  const { cookie } = await post("/api/auth/sign-in/email-otp", { email, otp: code }, anon);
  expect((await post("/api/ai/mine", { lang: "es", items: [{ form: "zorro", sentence: "Veo un zorro." }], known: [] }, cookie)).res.status).toBe(200);

  const write = await transactionFor("POST /api/write");
  expect(write.contexts.trace.data).toMatchObject({ writes: 1, writeTypes: "review.insert:1", writeChanged: true });
  const batch = write.spans.find((s) => s.description === "write batch");
  expect(batch).toMatchObject({ op: "db.write", parent_span_id: write.contexts.trace.span_id, trace_id: write.contexts.trace.trace_id });
  const writeLine = logLines.find((l) => l.msg === "request" && l.path === "/api/write");
  expect(writeLine?.traceId).toBe(write.contexts.trace.trace_id);

  const mine = await transactionFor("POST /api/ai/mine");
  expect(mine.contexts.trace.data).toMatchObject({ aiTask: "mine", aiOk: true });
  const generate = mine.spans.find((s) => s.description === "ai mine");
  expect(generate).toMatchObject({ op: "ai.generate", parent_span_id: mine.contexts.trace.span_id });
  // The model's HTTP call (Sentry's fetch instrumentation) sits under it.
  expect(mine.spans.some((s) => s.op === "http.client" && s.parent_span_id === generate?.span_id)).toBe(true);

  const signIn = await transactionFor("POST /api/auth/sign-in/email-otp");
  expect(signIn.contexts.trace.data).toMatchObject({ signup: "email", signin: "email" });
}, 30_000);

test("requests at the same time keep their own traces", async () => {
  // Learner i writes i + 1 reviews, all at once: each count must stay with its own trace.
  const learners = await Promise.all(Array.from({ length: 8 }, async () => (await post("/api/auth/sign-in/anonymous", {})).cookie));
  const before = transactions.length;
  await Promise.all(learners.map((cookie, i) => post("/api/write", { mutations: Array.from({ length: i + 1 }, (_, j) => review(word(j))) }, cookie)));
  await until(() => transactions.slice(before).filter((t) => t.transaction === "POST /api/write").length === learners.length);
  for (const write of transactions.slice(before).filter((t) => t.transaction === "POST /api/write")) {
    const n = write.contexts.trace.data?.writes;
    const batch = write.spans.find((s) => s.description === "write batch");
    expect({ n, batch: batch?.data?.mutations, parent: batch?.parent_span_id }).toEqual({ n, batch: n, parent: write.contexts.trace.span_id });
    const line = logLines.find((l) => l.msg === "request" && l.traceId === write.contexts.trace.trace_id);
    expect(line?.writes).toBe(n);
  }
}, 30_000);

async function until(check: () => boolean) {
  while (!check()) await Bun.sleep(50);
}

test("a server that can't start says why in Sentry and in its log", async () => {
  // The same address family as the server's (0.0.0.0), or macOS lets both bind the port.
  const taken = Bun.serve({ hostname: "0.0.0.0", port: 0, fetch: () => new Response() });
  try {
    const failed = start({ PORT: String(taken.port) });
    expect(await failed.exited).toBe(1);
    // It waits for Sentry to have the report before it exits.
    expect(errors.some((e) => JSON.stringify(e.exception).includes(String(taken.port)))).toBe(true);
    const lines = (await new Response(failed.stderr).text()).split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
    expect(lines.some((l) => l.level === "error" && l.msg === "server stopped")).toBe(true);
  } finally {
    taken.stop(true);
  }
}, 30_000);
