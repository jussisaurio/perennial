import { afterEach, expect, test } from "bun:test";
import { apiMessage } from "./ai";
import { ApiError, HttpError, isPermanent, NetworkError, postWrite, reloadNeeded } from "./http";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** The server (or whatever is in front of it) answers every request with this. */
function answer(status: number, body: string, contentType = "application/json") {
  globalThis.fetch = (async () => new Response(body, { status, headers: { "content-type": contentType } })) as unknown as typeof fetch;
}

const failure = (p: Promise<unknown>) => p.then(() => expect.unreachable("it should fail"), (e: unknown) => e);

/** The error a write fails with, which must be of class `C`. */
async function failsWith<C extends abstract new (...args: never[]) => unknown>(cls: C, p: Promise<unknown>): Promise<InstanceType<C>> {
  const e = await failure(p);
  if (!(e instanceof cls)) throw new Error(`expected ${cls.name}, got ${String(e)}`);
  return e as InstanceType<C>; // narrowed by the instanceof check above; TS does not carry it through the generic
}

test("a write the server took: its txid, and whether anything changed", async () => {
  answer(200, JSON.stringify({ txid: 42, changed: false }));
  expect(await postWrite([])).toEqual({ txid: 42, changed: false });
});

test("a contract error is an ApiError with its fields, and says whether to try again", async () => {
  answer(422, JSON.stringify({ error: "bad_request", issues: [{ path: ["mutations", 0], message: "Expected string" }] }));
  const refused = await failsWith(ApiError, postWrite([]));
  expect(refused.body).toEqual({ error: "bad_request", issues: [{ path: ["mutations", 0], message: "Expected string" }] });
  expect(refused.message).toBe("bad_request");
  expect(isPermanent(refused)).toBe(true);

  answer(401, JSON.stringify({ error: "sign_in_required" }));
  expect(isPermanent(await failsWith(ApiError, postWrite([])))).toBe(false);
  answer(429, JSON.stringify({ error: "quota", table: "user_word", limit: 5000 }));
  expect(isPermanent(await failsWith(ApiError, postWrite([])))).toBe(true);
  answer(429, JSON.stringify({ error: "slow_down" }));
  expect(isPermanent(await failsWith(ApiError, postWrite([])))).toBe(false);
});

test("please_reload asks the learner to reload", async () => {
  expect(reloadNeeded.needed).toBe(false);
  answer(426, JSON.stringify({ error: "please_reload", minVersion: "9.0.0" }));
  await failsWith(ApiError, postWrite([]));
  expect(reloadNeeded.needed).toBe(true);
});

test("an error page from a proxy is an HttpError: only its status is known", async () => {
  answer(502, "<html>Bad gateway</html>", "text/html");
  const e = await failsWith(HttpError, postWrite([]));
  expect(e.message).toBe("http_502");
  expect(isPermanent(e)).toBe(false);
});

test("a code this app does not know yet (a newer server) is judged by its status", async () => {
  answer(422, JSON.stringify({ error: "invalid" }));
  const e = await failsWith(HttpError, postWrite([]));
  expect(isPermanent(e)).toBe(true);
  expect(apiMessage(e)).toBe("Something went wrong. Try again later.");
});

test("no connection is a NetworkError with the browser's words", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  expect(apiMessage(await failsWith(NetworkError, postWrite([])))).toBe("Failed to fetch");
});

test("a success answer that breaks the contract fails loudly", async () => {
  answer(200, JSON.stringify({ txid: "42" }));
  const e = await failure(postWrite([]));
  expect(e).not.toBeInstanceOf(ApiError);
  expect(String(e)).toContain("txid");
});

const refused = (body: ApiError["body"]) => apiMessage(new ApiError({ body }));

test("each error the learner can act on has its own line", () => {
  expect(refused({ error: "out_of_credits", used: 47, limit: 50, left: 3, period: "2026-10", needed: 5 })).toMatch(/^You have only 3 AI words left this month\. Select fewer words, or wait until \w+ 1\.$/);
  expect(refused({ error: "out_of_credits", used: 50, limit: 50, left: 0, period: "2026-10", needed: 1 })).toBe("You used all your AI words for this month.");
  expect(refused({ error: "busy" })).toBe("Perennial AI is very busy now. Try again in a few minutes.");
  expect(refused({ error: "paused", until: "2026-11-01" })).toBe("Perennial AI is paused until November 1 because it reached its monthly cost limit.");
  expect(refused({ error: "ai_off" })).toBe("Perennial AI is not available on this server.");
  expect(refused({ error: "quota", table: "user_word", limit: 5000 })).toBe("You have too many of your own words and sentences to add more. Delete some on the Words screen (From my texts) first.");
  expect(refused({ error: "slow_down" })).toBe("Too many requests. Wait a moment and try again.");
  expect(refused({ error: "account_required" })).toBe("Sign in with your email to use Perennial AI.");
  expect(refused({ error: "sign_in_required" })).toBe("Sign in with your email to use Perennial AI.");
  expect(refused({ error: "ai_error", status: 529 })).toBe("Something went wrong. Try again later.");
  expect(refused({ error: "internal_error", requestId: "r1" })).toBe("Something went wrong. Try again later.");
});
