import { describe, expect, mock, test } from "bun:test";

const calls: { init?: [string, Record<string, unknown>]; captured: [string, unknown, unknown][]; aliases: string[]; inits: number } = { captured: [], aliases: [], inits: 0 };
mock.module("posthog-js", () => ({
  default: {
    init: (key: string, config: Record<string, unknown>) => {
      calls.init = [key, config];
      calls.inits++;
    },
    capture: (event: string, props: unknown, options?: unknown) => void calls.captured.push([event, props, options]),
    alias: (id: string) => void calls.aliases.push(id),
  },
}));
// As the Docker build sets them: a key, and an unset host passed as "". Read once, at import.
const saved = { key: process.env.VITE_POSTHOG_KEY, host: process.env.VITE_POSTHOG_HOST };
process.env.VITE_POSTHOG_KEY = "phc_test";
process.env.VITE_POSTHOG_HOST = "";
const { identify, linkAccount, track } = await import("./observability");
for (const [k, v] of [["VITE_POSTHOG_KEY", saved.key], ["VITE_POSTHOG_HOST", saved.host]] as const) {
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
}

describe("PostHog", () => {
  test("starts at identify, as that learner, on the EU host; earlier events wait and then go", async () => {
    track("course_started", { lang: "es" });
    const happened = Date.now();
    expect(calls.init).toBeUndefined();
    identify("user-1");
    identify("user-1"); // StrictMode runs the effect twice: one start
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.inits).toBe(1);
    const [key, config] = calls.init!;
    expect(key).toBe("phc_test");
    expect(config).toMatchObject({
      api_host: "https://eu.i.posthog.com",
      persistence: "memory",
      bootstrap: { distinctID: "user-1", isIdentifiedID: true },
      autocapture: false,
      disable_external_dependency_loading: true,
      advanced_disable_flags: true,
    });
    // Sent once, with the time it happened, not the time it was sent.
    expect(calls.captured).toHaveLength(1);
    const [event, props, options] = calls.captured[0] as [string, unknown, { timestamp: Date }];
    expect([event, props]).toEqual(["course_started", { lang: "es" }]);
    expect(Math.abs(options.timestamp.getTime() - happened)).toBeLessThan(50);
    track("garden_opened");
    expect(calls.captured.at(-1)?.slice(0, 2)).toEqual(["garden_opened", {}]);
  });

  test("an anonymous learner who adds an email stays one person: the account id is an alias", () => {
    linkAccount("account-1");
    expect(calls.aliases).toEqual(["account-1"]);
  });
});
