// A client that goes away mid-request (a closed tab, a lost connection): a
// write, an AI call and an account deletion still run to their end, line in
// the log included, so nothing stops half-way. Only a shape long poll stops,
// and it stops its upstream fetch to Electric too.

import { afterAll, expect, test } from "bun:test";
import { mockLLM, review, startApp, stopMockLLM, unique, W } from "./helpers";

type App = Awaited<ReturnType<typeof startApp>>;
type Line = Record<string, unknown>;

/** A stand-in upstream (Electric, the model) that holds each request until `release()`, then answers or forwards it. */
function heldUpstream(forward?: string) {
  const arrived = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      req.signal.addEventListener("abort", () => aborted.resolve());
      const body = await req.text();
      arrived.resolve();
      await gate.promise;
      if (!forward) return new Response("[]", { headers: { "content-type": "application/json" } });
      const url = new URL(req.url);
      return fetch(forward + url.pathname + url.search, { method: req.method, headers: req.headers, body });
    },
  });
  return { url: `http://localhost:${server.port}`, arrived: arrived.promise, aborted: aborted.promise, release: () => gate.resolve(), stop: () => server.stop(true) };
}

/** Lock a learner's user row in a transaction of our own, so the server's next write to them waits for us. */
async function lockUser(t: App, userId: string) {
  const conn = await t.sql.reserve();
  await conn`begin`;
  await conn`select id from "user" where id = ${userId} for update`;
  const [{ pid }] = await conn`select pg_backend_pid() as pid`;
  return {
    /** Resolves once a server query waits for our lock. */
    waited: () => until(async () => (await t.sql`select 1 from pg_stat_activity where ${pid} = any(pg_blocking_pids(pid))`).length > 0),
    async release() {
      await conn`commit`;
      conn.release();
    },
  };
}

/** Wait until `check` is true: once its client is gone, the server finishes in its own time. */
async function until(check: () => boolean | Promise<boolean>) {
  while (!(await check())) await Bun.sleep(10);
}

/** Bun learns of a disconnect from the socket; there is no event a test can wait for, so give it a moment. */
const disconnectSeen = () => Bun.sleep(100);

/** Run `fn` with the JSON log lines printed meanwhile collected in `lines`. */
async function withLog(fn: (lines: Line[]) => Promise<void>) {
  const lines: Line[] = [];
  const saved = { log: console.log, level: process.env.LOG_LEVEL };
  console.log = (line: unknown) => {
    try {
      lines.push(JSON.parse(String(line)));
    } catch {
      // [mail] lines from the dev outbox
    }
  };
  process.env.LOG_LEVEL = "info";
  try {
    await fn(lines);
  } finally {
    console.log = saved.log;
    process.env.LOG_LEVEL = saved.level;
  }
}

/** Send a POST as the app would, and go away when `client` aborts. */
const post = (t: App, path: string, body: unknown, cookie: string, client: AbortController) =>
  fetch(t.url + path, { method: "POST", signal: client.signal, headers: { "content-type": "application/json", origin: t.config.appUrl, cookie }, body: JSON.stringify(body) }).catch(() => "aborted");

const requestLine = (lines: Line[], path: string) => lines.find((l) => l.msg === "request" && l.path === path);

const t = await startApp();
afterAll(async () => (await t.stop(), stopMockLLM()));

test("a write finishes after its client is gone", async () => {
  const cookie = await t.anonymous();
  const id = (await t.me(cookie)).id;
  await withLog(async (lines) => {
    const lock = await lockUser(t, id);
    const client = new AbortController();
    const sent = post(t, "/api/write", { mutations: [review(W.a)] }, cookie, client);
    await lock.waited();
    client.abort();
    expect(await sent).toBe("aborted");
    await disconnectSeen();
    await lock.release();
    await until(() => !!requestLine(lines, "/api/write"));
    expect(requestLine(lines, "/api/write")).toMatchObject({ status: 200, writeChanged: true, userId: id });
  });
  expect((await t.sql`select 1 from review where user_id = ${id}`).length).toBe(1);
});

test("an account deletion finishes after its client is gone", async () => {
  const cookie = await t.anonymous();
  const id = (await t.me(cookie)).id;
  await withLog(async (lines) => {
    const lock = await lockUser(t, id);
    const client = new AbortController();
    const sent = post(t, "/api/account/delete", {}, cookie, client);
    await lock.waited();
    client.abort();
    expect(await sent).toBe("aborted");
    await disconnectSeen();
    await lock.release();
    await until(() => !!requestLine(lines, "/api/account/delete"));
    expect(requestLine(lines, "/api/account/delete")).toMatchObject({ status: 200, accountDeleted: true });
  });
  expect((await t.sql`select 1 from "user" where id = ${id}`).length).toBe(0);
});

test("an AI call finishes, and is paid for, after its client is gone", async () => {
  const model = heldUpstream(await mockLLM());
  const ai = await startApp({ anthropic: { apiKey: "test-key", baseURL: model.url, model: "claude-haiku-4-5" } });
  try {
    const cookie = await ai.signIn(unique("leaver"));
    await withLog(async (lines) => {
      const client = new AbortController();
      const sent = post(ai, "/api/ai/mine", { lang: "es", items: [{ form: "zorro", sentence: "Veo un zorro." }], known: [] }, cookie, client);
      await model.arrived;
      client.abort();
      expect(await sent).toBe("aborted");
      await disconnectSeen();
      model.release();
      await until(() => !!requestLine(lines, "/api/ai/mine"));
      expect(requestLine(lines, "/api/ai/mine")).toMatchObject({ status: 200, aiOk: true });
    });
    // The word came back, so its credit stays spent (not refunded as if the call failed).
    expect((await ai.me(cookie)).credits.used).toBe(1);
  } finally {
    model.stop();
    await ai.stop();
  }
});

test("a shape poll whose client is gone stops its fetch to Electric", async () => {
  const electric = heldUpstream();
  const app = await startApp({ electric: { url: electric.url } });
  try {
    const cookie = await app.anonymous();
    const client = new AbortController();
    const sent = fetch(`${app.url}/api/shape?table=review&offset=-1`, { signal: client.signal, headers: { cookie } }).catch(() => "aborted");
    await electric.arrived;
    client.abort();
    expect(await sent).toBe("aborted");
    await electric.aborted;
  } finally {
    electric.release();
    electric.stop();
    await app.stop();
  }
});
