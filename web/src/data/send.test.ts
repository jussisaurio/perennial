import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { Effect } from "effect";
import type { ApiError, HttpError } from "./http";
import { Refused, sendUntilStored } from "./send";

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
  void Effect.runPromise(sendUntilStored([], "key-1", { otherUser, wake, onRefused: (e) => refused.push(e) })).then(
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
