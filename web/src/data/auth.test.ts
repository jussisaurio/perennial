import { afterEach, beforeEach, expect, jest, mock, test } from "bun:test";

// Better Auth's client, faked: each test says how the server answers.
type Answer<T> = (signal: AbortSignal) => Promise<T>;
type User = { id: string; email: string; isAnonymous?: boolean | null };
type Refusal = { code?: string; status: number } | null;
const server: {
  session: Answer<{ data: { user: User } | null }>;
  sendCode: Answer<{ error: Refusal }>;
  signIn: Answer<{ data: { user: User } | null; error: Refusal }>;
} = {
  session: () => Promise.resolve({ data: null }),
  sendCode: () => Promise.resolve({ error: null }),
  signIn: () => Promise.resolve({ data: null, error: { status: 401 } }),
};
mock.module("better-auth/react", () => ({
  createAuthClient: () => ({
    getSession: (o: { fetchOptions: { signal: AbortSignal } }) => server.session(o.fetchOptions.signal),
    emailOtp: { sendVerificationOtp: (o: { fetchOptions: { signal: AbortSignal } }) => server.sendCode(o.fetchOptions.signal) },
    signIn: { emailOtp: (o: { fetchOptions: { signal: AbortSignal } }) => server.signIn(o.fetchOptions.signal) },
  }),
}));
mock.module("better-auth/client/plugins", () => ({ anonymousClient: () => ({}), emailOTPClient: () => ({}) }));

const events: unknown[][] = [];
mock.module("../observability", () => ({
  track: (...a: unknown[]) => events.push(["track", ...a]),
  linkAccount: (...a: unknown[]) => events.push(["linkAccount", ...a]),
  reportSlowAuth: (...a: unknown[]) => events.push(["reportSlowAuth", ...a]),
  reportBadAnswer: () => {},
}));
mock.module("./captcha", () => ({ captchaHeaders: () => Promise.resolve({}) }));

const { AuthError, sendCode, signInWithCode } = await import("./auth");
const { adoptedBy } = await import("./device");

/** localStorage, in memory: device.ts keeps the pending link and the adoptions there. */
class MemoryStorage {
  private items = new Map<string, string>();
  getItem = (k: string) => this.items.get(k) ?? null;
  setItem = (k: string, v: string) => void this.items.set(k, v);
  removeItem = (k: string) => void this.items.delete(k);
}

/** A request that never gets an answer. `aborted` says whether its fetch was stopped. */
function hang() {
  const seen = { aborted: false };
  const answer = (signal: AbortSignal) =>
    new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () => {
        seen.aborted = true;
        reject(new DOMException("aborted", "AbortError"));
      }),
    );
  return { seen, answer };
}

const anonymous: User = { id: "anon-1", email: "temp@anon.local", isAnonymous: true };
const account: User = { id: "acct-1", email: "ana@example.com", isAnonymous: false };

/** Let promise callbacks run. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

let reloads = 0;
beforeEach(() => {
  jest.useFakeTimers({ now: new Date("2026-10-16T12:00:00Z") });
  events.length = 0;
  reloads = 0;
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
  // A reload logs whose queues the account had taken over by then.
  Object.defineProperty(globalThis, "location", { value: { reload: () => (reloads++, events.push(["reload", adoptedBy("acct-1")])) }, configurable: true });
});
afterEach(() => {
  jest.useRealTimers();
});

test("a code request with no answer: one slow report at 10 s, then maybe-sent at 20 s, and the request is stopped", async () => {
  const { seen, answer } = hang();
  server.sendCode = answer;
  let result: string | undefined;
  void sendCode("ana@example.com").then((r) => (result = r));
  await settle();
  jest.advanceTimersByTime(9_999);
  await settle();
  expect(events.filter((e) => e[0] === "reportSlowAuth")).toEqual([]);
  jest.advanceTimersByTime(1);
  await settle();
  expect(events.filter((e) => e[0] === "reportSlowAuth")).toEqual([["reportSlowAuth", "send", "/email-otp/send-verification-otp", 10_000, undefined]]);
  jest.advanceTimersByTime(10_000);
  await settle();
  expect(result).toBe("maybe-sent");
  expect(seen.aborted).toBe(true);
});

test("a code request answered in time: no slow report later", async () => {
  server.sendCode = () => Promise.resolve({ error: null });
  expect(await sendCode("ana@example.com")).toBe("sent");
  jest.advanceTimersByTime(30_000);
  await settle();
  expect(events.filter((e) => e[0] === "reportSlowAuth")).toEqual([]);
});

test("too many codes: the learner is told to wait", async () => {
  server.sendCode = () => Promise.resolve({ error: { code: "TOO_MANY_REQUESTS", status: 429 } });
  const e = await sendCode("ana@example.com").catch((x: unknown) => x);
  expect(e).toBeInstanceOf(AuthError);
  expect(e).toHaveProperty("message", "Too many codes. Wait a few minutes, then try again.");
});

test("a wrong code is refused with a line the learner can act on", async () => {
  server.session = () => Promise.resolve({ data: { user: anonymous } });
  server.signIn = () => Promise.resolve({ data: null, error: { code: "INVALID_OTP", status: 400 } });
  const e = await signInWithCode("ana@example.com", "123456").catch((x: unknown) => x);
  expect(e).toBeInstanceOf(AuthError);
  expect(e).toHaveProperty("message", "That code is not correct, or it has expired.");
  expect(adoptedBy("acct-1")).toEqual([]);
});

test("a sign-in answered in time: the anonymous learner's writes go to the account, with no reload", async () => {
  server.session = () => Promise.resolve({ data: { user: anonymous } });
  server.signIn = () => Promise.resolve({ data: { user: account }, error: null });
  const user = await signInWithCode("ana@example.com", "123456");
  expect(user).toEqual({ id: "acct-1", email: "ana@example.com", anonymous: false });
  expect(events).toEqual([["track", "email_added"], ["linkAccount", "acct-1"], ["track", "signin_done", { ms: 0, timedOut: false }]]);
  expect(adoptedBy("acct-1")).toEqual(["anon-1"]);
  expect(reloads).toBe(0);
});

test("a sign-in whose answer is lost, when the server did sign in: asks the server, adopts, then reloads", async () => {
  let sessionUser = anonymous;
  server.session = () => Promise.resolve({ data: { user: sessionUser } });
  const { seen, answer } = hang();
  server.signIn = (signal) => {
    // The server signs in; only its answer never comes.
    sessionUser = account;
    return answer(signal);
  };
  let user: unknown;
  void signInWithCode("Ana@Example.com", "123456").then((u) => (user = u));
  await settle();
  jest.advanceTimersByTime(20_000);
  await settle();
  expect(seen.aborted).toBe(true);
  expect(user).toEqual({ id: "acct-1", email: "ana@example.com", anonymous: false });
  expect(events.filter((e) => e[0] !== "reportSlowAuth")).toEqual([
    ["track", "email_added"],
    ["linkAccount", "acct-1"],
    ["track", "signin_done", { ms: 20_000, timedOut: true }],
    ["reload", ["anon-1"]],
  ]);
});

test("a sign-in whose answer is lost, when the server did not sign in: says it took too long", async () => {
  server.session = () => Promise.resolve({ data: { user: anonymous } });
  server.signIn = hang().answer;
  let error: unknown;
  void signInWithCode("ana@example.com", "123456").catch((e: unknown) => (error = e));
  await settle();
  jest.advanceTimersByTime(20_000);
  await settle();
  expect(error).toBeInstanceOf(AuthError);
  expect(error).toHaveProperty("code", "timeout");
  expect(reloads).toBe(0);
});

test("a try again after a lost answer, from the account's session: the anonymous learner's writes still follow", async () => {
  // First try: the server signs in, the answer is lost, and asking the server fails too.
  let sessionUser = anonymous;
  let sessionDown = false;
  server.session = () => (sessionDown ? Promise.resolve({ data: null }) : Promise.resolve({ data: { user: sessionUser } }));
  const lost = hang();
  server.signIn = (signal) => {
    sessionUser = account;
    sessionDown = true;
    return lost.answer(signal);
  };
  let error: unknown;
  void signInWithCode("ana@example.com", "111111").catch((e: unknown) => (error = e));
  await settle();
  jest.advanceTimersByTime(20_000);
  await settle();
  expect(error).toHaveProperty("code", "timeout");

  // Second try: the session is the account now.
  sessionDown = false;
  server.signIn = () => Promise.resolve({ data: { user: account }, error: null });
  await signInWithCode("ana@example.com", "222222");
  expect(adoptedBy("acct-1")).toEqual(["anon-1"]);
});
