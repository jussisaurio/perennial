import { expect, mock, test } from "bun:test";

const reports: unknown[][] = [];
mock.module("../observability", () => ({ reportBadAnswer: (...a: unknown[]) => reports.push(a) }));
const { loadServerInfo, newDeploy, versionAtLeast } = await import("./server");
const { reloadNeeded } = await import("./http");

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

/** Let promise callbacks run. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

test("an answer this app can't fully read still says when to reload; it is reported once, and never rejects", async () => {
  let asked = 0;
  reloadNeeded.addEventListener("reload", () => asked++);
  let tabBack = () => {};
  Object.defineProperty(globalThis, "document", {
    value: { visibilityState: "visible", addEventListener: (_: string, fn: () => void) => (tabBack = fn) },
    configurable: true,
  });
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  try {
    // A newer server: its features have a shape this app does not know, and it needs a newer app.
    globalThis.fetch = (async () => Response.json({ release: "r2", minClientVersion: "99.0.0", features: ["ai"] })) as unknown as typeof fetch;
    loadServerInfo();
    await settle();
    expect(asked).toBe(1);
    expect(reports.length).toBe(1);

    // The tab comes back later; this time a 200 page that is not JSON at all.
    globalThis.fetch = (async () => new Response("<html>maintenance</html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    Date.now = () => realNow() + 10 * 60_000;
    tabBack();
    await settle();
    expect(reports.length).toBe(1);
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
    Reflect.deleteProperty(globalThis, "document");
  }
});
