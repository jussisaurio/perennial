import { beforeEach, expect, test } from "bun:test";
import { adoptedBy, forgetOnDevice, noteSignIn, resolvePendingLink } from "./device";

/** localStorage, in memory. */
class MemoryStorage {
  private items = new Map<string, string>();
  getItem = (k: string) => this.items.get(k) ?? null;
  setItem = (k: string, v: string) => void this.items.set(k, v);
  removeItem = (k: string) => void this.items.delete(k);
}

beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
});

const anonymous = { id: "anon-x", email: null, anonymous: true };
const accountX = { id: "acct-x", email: "x@example.com", anonymous: false };

test("a sign-in from an anonymous session: the account with that email takes over the queue", () => {
  noteSignIn(anonymous, "X@Example.com");
  resolvePendingLink("acct-x", "x@example.com");
  expect(adoptedBy("acct-x")).toEqual(["anon-x"]);
  // Done: a later start does not adopt again.
  resolvePendingLink("acct-x", "x@example.com");
  expect(adoptedBy("acct-x")).toEqual(["anon-x"]);
});

test("a try again from the account's session (the server had signed in, the answer was lost) keeps the link", () => {
  noteSignIn(anonymous, "x@example.com");
  noteSignIn(accountX, "X@example.com");
  resolvePendingLink("acct-x", "x@example.com");
  expect(adoptedBy("acct-x")).toEqual(["anon-x"]);
});

test("another person signing in from X's account session does not get X's queue", () => {
  noteSignIn(anonymous, "x@example.com");
  noteSignIn(accountX, "y@example.com");
  resolvePendingLink("acct-y", "y@example.com");
  resolvePendingLink("acct-x", "x@example.com");
  expect(adoptedBy("acct-y")).toEqual([]);
  expect(adoptedBy("acct-x")).toEqual([]);
});

test("an account with another email does not take the link, and leaves it for the right one", () => {
  noteSignIn(anonymous, "x@example.com");
  resolvePendingLink("acct-y", "y@example.com");
  expect(adoptedBy("acct-y")).toEqual([]);
  resolvePendingLink("acct-x", "x@example.com");
  expect(adoptedBy("acct-x")).toEqual(["anon-x"]);
});

test("signing in from no session, or signing the anonymous learner out, drops the link", () => {
  noteSignIn(anonymous, "x@example.com");
  noteSignIn(null, "x@example.com");
  resolvePendingLink("acct-x", "x@example.com");
  expect(adoptedBy("acct-x")).toEqual([]);

  noteSignIn(anonymous, "x@example.com");
  forgetOnDevice("anon-x");
  resolvePendingLink("acct-x", "x@example.com");
  expect(adoptedBy("acct-x")).toEqual([]);
});
