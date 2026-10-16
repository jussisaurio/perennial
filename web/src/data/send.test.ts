import { afterEach, expect, test } from "bun:test";
import { DefaultRetryPolicy, NonRetriableError } from "@tanstack/offline-transactions";
import { Effect } from "effect";
import type { ApiError, HttpError } from "./http";
import { OtherUser, sendQueued, shouldRetry } from "./send";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answer(status: number, body: string, contentType = "application/json") {
  globalThis.fetch = (async () => new Response(body, { status, headers: { "content-type": contentType } })) as unknown as typeof fetch;
}

/** What the offline queue does with a failed batch, as TanStack's executor decides it. */
const triedAgain = (e: Error) => (e instanceof NonRetriableError ? false : (shouldRetry(e) ?? new DefaultRetryPolicy().shouldRetry(e, 0)));

/** Send one batch; the error it fails with, and the refusals counted. */
async function send() {
  const refused: (ApiError | HttpError)[] = [];
  const result = await Effect.runPromise(sendQueued([], "key-1", (e) => refused.push(e))).then(
    (r) => ({ ok: r, error: null }),
    (e: Error) => ({ ok: undefined, error: e }),
  );
  return { ...result, refused };
}

test("a proxy's 401 page: the batch is kept and tried again", async () => {
  answer(401, "<html>Unauthorized</html>", "text/html");
  const { error, refused } = await send();
  expect(triedAgain(error!)).toBe(true);
  expect(refused).toEqual([]);
});

test("a proxy's 426 page: tried again after the reload", async () => {
  answer(426, "<html>Upgrade</html>", "text/html");
  expect(triedAgain((await send()).error!)).toBe(true);
});

test("a code from a newer server with 400 or 403: tried again, not dropped", async () => {
  for (const status of [400, 403]) {
    answer(status, JSON.stringify({ error: "new_code" }));
    const { error, refused } = await send();
    expect(error!.message).toBe("new_code");
    expect(triedAgain(error!)).toBe(true);
    expect(refused).toEqual([]);
  }
});

test("quota for a table this app does not know: refused for good, and counted", async () => {
  answer(429, JSON.stringify({ error: "quota", table: "new_table", limit: 10 }));
  const { error, refused } = await send();
  expect(error).toBeInstanceOf(NonRetriableError);
  expect(triedAgain(error!)).toBe(false);
  expect(refused.map((e) => e.message)).toEqual(["quota"]);
});

test("a contract refusal is counted; a lost session is tried again", async () => {
  answer(422, JSON.stringify({ error: "review_from_the_future" }));
  const first = await send();
  expect(triedAgain(first.error!)).toBe(false);
  expect(first.refused.map((e) => e.message)).toEqual(["review_from_the_future"]);

  answer(401, JSON.stringify({ error: "sign_in_required" }));
  expect(triedAgain((await send()).error!)).toBe(true);
  expect(triedAgain(new OtherUser())).toBe(true);
});

test("an answer that breaks the contract after the server took the write: counted as sent, no echo to wait for", async () => {
  answer(200, "<html>OK</html>", "text/html");
  expect(await send()).toEqual({ ok: null, error: null, refused: [] });
});
