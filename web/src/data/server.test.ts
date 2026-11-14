import { afterAll, beforeAll, expect, mock, test } from "bun:test";

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

// The tab's events and timer. loadServerInfo sets them up once per module, so the tests share them.
const on = new Map<string, () => void>();
const listen = (event: string, fn: () => void) => void on.set(event, fn);
const tab = { visibilityState: "visible", addEventListener: listen };
let inView = () => {};
const fire = (event: string) => {
  const fn = on.get(event);
  if (!fn) throw new Error(`nothing listens for ${event}`);
  fn();
};
beforeAll(() => {
  Object.defineProperty(globalThis, "document", { value: tab, configurable: true });
  Object.defineProperty(globalThis, "window", { value: { addEventListener: listen }, configurable: true });
});
afterAll(() => {
  Reflect.deleteProperty(globalThis, "document");
  Reflect.deleteProperty(globalThis, "window");
});
function load() {
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = ((fn: () => void) => ((inView = fn), 0)) as unknown as typeof setInterval;
  try {
    loadServerInfo();
  } finally {
    globalThis.setInterval = realSetInterval;
  }
}

test("an answer this app can't fully read still says when to reload; it is reported, and never rejects", async () => {
  let asked = 0;
  reloadNeeded.addEventListener("reload", () => asked++);
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  try {
    // A newer server: its features have a shape this app does not know, and it needs a newer app.
    globalThis.fetch = (async () => Response.json({ release: "r2", minClientVersion: "99.0.0", features: ["ai"] })) as unknown as typeof fetch;
    load();
    await settle();
    expect(asked).toBe(1);
    // The start's /api/boot answer breaks the contract too, so /api/server is asked as well.
    expect(reports.map((r) => r[0])).toEqual(["/api/boot", "/api/server"]);

    // The tab comes back later; this time a 200 page that is not JSON at all.
    globalThis.fetch = (async () => new Response("<html>maintenance</html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    Date.now = () => realNow() + 10 * 60_000;
    fire("visibilitychange");
    await settle();
    expect(reports.length).toBe(3); // reportBadAnswer itself keeps it to one Sentry event per path
  } finally {
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
});

test("a tab that is never hidden asks again now and then, and when the network comes back (#123)", async () => {
  let asks = 0;
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  const at = (minutes: number) => {
    Date.now = () => realNow() + minutes * 60_000;
  };
  try {
    globalThis.fetch = (async () => (asks++, Response.json({ release: "dev", minClientVersion: "0.0.0", features: { ai: false, google: false } }))) as unknown as typeof fetch;
    load();
    await settle();
    asks = 0;
    // On a second screen: never hidden, so only the timer asks.
    at(60);
    inView();
    await settle();
    expect(asks).toBe(1);
    // The network comes back a minute later: too soon to ask again.
    at(61);
    fire("online");
    await settle();
    expect(asks).toBe(1);
    // A laptop that wakes up hours later: the network comes back, and it asks.
    at(300);
    fire("online");
    await settle();
    expect(asks).toBe(2);
    // A hidden tab does not ask.
    tab.visibilityState = "hidden";
    at(400);
    inView();
    await settle();
    expect(asks).toBe(2);
  } finally {
    tab.visibilityState = "visible";
    globalThis.fetch = realFetch;
    Date.now = realNow;
  }
});
