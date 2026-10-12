import { expect, mock, test } from "bun:test";

// server.ts imports the store (for the reload signal), which needs Vite; only the pure parts are tested here.
mock.module("./store", () => ({ reloadNeeded: new EventTarget() }));
const { newDeploy, versionAtLeast } = await import("./server");

test("a new deploy: a different real release than the one this app was built from", () => {
  expect(newDeploy("abc123", "abc123")).toBe(false);
  expect(newDeploy("def456", "abc123")).toBe(true);
  expect(newDeploy("def456", "dev")).toBe(false); // local builds never nag
  expect(newDeploy("dev", "abc123")).toBe(false);
  expect(newDeploy("", "abc123")).toBe(false);
});

test("versions compare by number", () => {
  expect(versionAtLeast("1.10.0", "1.9.2")).toBe(true);
  expect(versionAtLeast("0.1.0", "0.2.0")).toBe(false);
  expect(versionAtLeast("0.1.0", "0.1.0")).toBe(true);
});
