import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { Effect } from "effect";
import type { ApiError, HttpError } from "./http";
import { Refused, sendUntilStored, writeQueue } from "./send";

const realFetch = globalThis.fetch;
/** The server's answers, in order; the last one repeats. */
let answers: Response[] = [];
let calls = 0;
beforeEach(() => {
  jest.useFakeTimers({ now: new Date("2026-11-07T12:00:00Z") });
  calls = 0;
  globalThis.fetch = (async () => answers[Math.min(calls++, answers.length - 1)]!.clone()) as unknown as typeof fetch;
});
afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = realFetch;
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const html = (status: number) => new Response("<html>page</html>", { status, headers: { "content-type": "text/html" } });
const stored = json(200, { changed: true, stored: { course: [], word_state: [] } });

/** Let promise callbacks run. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** Start sending one write; `result` fills in when it ends. `wake` ends a wait between tries (back online). */
function send(otherUser = () => false, wake = () => new Promise<void>(() => {})) {
  const refused: (ApiError | HttpError)[] = [];
  const result: { ok?: unknown; error?: unknown } = {};
  void Effect.runPromise(sendUntilStored({ mutations: [] }, { otherUser, wake, onRefused: (e) => refused.push(e) })).then(
    (ok) => (result.ok = ok),
    (error: unknown) => (result.error = error),
  );
  return { result, refused };
}

/** Run the clock forward, a second at a time, letting each try finish. */
async function wait(ms: number) {
  for (let t = 0; t < ms; t += 1000) {
    await settle();
    jest.advanceTimersByTime(1000);
  }
  await settle();
}

test("no answer the app can use (a proxy's 401 or 426 page, a newer server's code): tried again until the server has it", async () => {
  answers = [html(401), html(426), json(400, { error: "new_code" }), json(403, { error: "new_code" }), json(401, { error: "sign_in_required" }), stored];
  const { result, refused } = send();
  await wait(60_000);
  expect(calls).toBe(6);
  expect(result.ok).toEqual({ changed: true, stored: { course: [], word_state: [] } });
  expect(refused).toEqual([]);
});

test("no connection: tried again, at most 30 s apart", async () => {
  globalThis.fetch = (async () => {
    calls++;
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  const { result } = send();
  await wait(60_000);
  const before = calls;
  await wait(30_000);
  expect(calls).toBe(before + 1);
  expect(result).toEqual({});
});

test("back online: tried again at once, not after the wait", async () => {
  let fail = true;
  globalThis.fetch = (async () => {
    calls++;
    if (fail) throw new TypeError("Failed to fetch");
    return stored.clone();
  }) as unknown as typeof fetch;
  let online = () => {};
  const { result } = send(undefined, () => new Promise<void>((r) => (online = r)));
  // Tries at 0, 1, 3, 7, 15 s; the next is 16 s later.
  await wait(16_000);
  const before = calls;
  fail = false;
  online();
  await settle();
  expect(calls).toBe(before + 1);
  expect(result.ok).toBeDefined();
});

test("a refusal for good (quota for a table this app does not know): not sent again, and counted", async () => {
  answers = [json(429, { error: "quota", table: "new_table", limit: 10 })];
  const { result, refused } = send();
  await wait(10_000);
  expect(calls).toBe(1);
  expect(result.error).toBeInstanceOf(Refused);
  expect(refused.map((e) => e.message)).toEqual(["quota"]);
});

test("another user signed in here: nothing is sent for them until this user is back", async () => {
  answers = [stored];
  let other = true;
  const { result } = send(() => other);
  await wait(10_000);
  expect(calls).toBe(0);
  other = false;
  await wait(30_000);
  expect(calls).toBe(1);
  expect(result.ok).toBeDefined();
});

test("an answer that breaks the contract after the server took the write: counted as sent", async () => {
  answers = [html(200)];
  const { result, refused } = send();
  await wait(0);
  expect(result).toEqual({ ok: null });
  expect(refused).toEqual([]);
});

/** The bodies the server got, and whether each was a keepalive request. */
let bodies: { mutations: { id: number }[]; from: { seq: number[] }; keepalive: boolean; bytes: number }[] = [];
/** Answer every write request with `answer`, keeping its body. */
function server(answer: (body: (typeof bodies)[number]) => Response | Promise<Response>) {
  bodies = [];
  globalThis.fetch = (async (_path: string, init: RequestInit) => {
    calls++;
    const text = init.body as string;
    const body = { ...(JSON.parse(text) as Pick<(typeof bodies)[number], "mutations" | "from">), keepalive: !!init.keepalive, bytes: new TextEncoder().encode(text).length };
    bodies.push(body);
    return answer(body);
  }) as unknown as typeof fetch;
}
/** A write of one mutation about the size of a review (~250 bytes). */
const write = (id: number) => [{ id, pad: "x".repeat(230) }];

function queue() {
  const refused: (ApiError | HttpError)[] = [];
  let online = () => {};
  const q = writeQueue({ otherUser: () => false, wake: () => new Promise<void>((r) => (online = r)), onRefused: (e) => refused.push(e), signal: new AbortController().signal });
  return { q, refused, online: () => online() };
}

test("a backlog made offline goes in a few requests, not one per write, each under 64 KB (#817)", async () => {
  let up = false;
  server(() => (up ? stored.clone() : Promise.reject(new TypeError("Failed to fetch"))));
  const { q, online } = queue();
  const done = Array.from({ length: 600 }, (_, i) => q.send(write(i)));
  await settle();
  up = true;
  const before = bodies.length;
  online();
  await Promise.all(done);
  const sent = bodies.slice(before);
  expect(sent.length).toBeLessThanOrEqual(4);
  expect(sent.flatMap((b) => b.mutations.map((m) => m.id))).toEqual(Array.from({ length: 600 }, (_, i) => i));
  for (const b of sent) expect(b.bytes).toBeLessThanOrEqual(64 * 1024);
});

test("the page goes away: the oldest writes that fit go in one keepalive request under 64 KB, with the one on the way, numbered (#817, #818)", async () => {
  server(() => new Promise<Response>(() => {})); // The first request never answers.
  const { q } = queue();
  for (let i = 0; i < 600; i++) void q.send(write(i));
  await settle();
  q.pageHide();
  await settle();
  expect(bodies.length).toBe(2);
  const [onTheWay, last] = bodies as [(typeof bodies)[number], (typeof bodies)[number]];
  expect(last.keepalive).toBe(true);
  expect(last.bytes).toBeLessThanOrEqual(64 * 1024);
  expect(last.mutations.length).toBeGreaterThan(200);
  // From the oldest, the writes on the way too, with the numbers they were sent with: the server applies each number once.
  const ids = last.mutations.map((m) => m.id);
  expect(ids).toEqual(Array.from({ length: ids.length }, (_, i) => i));
  expect(last.from.seq).toEqual(ids);
  expect(last.from.seq.slice(0, onTheWay.from.seq.length)).toEqual(onTheWay.from.seq);
});

test("one write refused for good in a batch: only that one is refused, the others are stored (#817)", async () => {
  server((b) => (b.mutations.some((m) => m.id === 1) ? json(422, { error: "review_from_the_future" }) : stored.clone()));
  const { q, refused } = queue();
  const results = await Promise.allSettled([0, 1, 2].map((i) => q.send(write(i))));
  expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  expect(refused.map((e) => e.message)).toEqual(["review_from_the_future"]);
  expect(bodies.map((b) => b.mutations.map((m) => m.id))).toEqual([[0], [1, 2], [1], [2]]);
});
