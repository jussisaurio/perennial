import { describe, expect, spyOn, test } from "bun:test";
import { registerServiceWorker } from "./serviceWorker";

describe("service worker registration (#181)", () => {
  test("a refusal is a warning, not an unhandled error", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    await expect(registerServiceWorker({ register: () => Promise.reject(new Error("Rejected")) })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test("registers /sw.js for the whole app", async () => {
    const calls: unknown[][] = [];
    await registerServiceWorker({ register: (...args: unknown[]) => (calls.push(args), Promise.resolve({} as ServiceWorkerRegistration)) } as never);
    expect(calls).toEqual([["/sw.js", { scope: "/" }]]);
  });
});
