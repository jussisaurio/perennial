import { describe, expect, mock, test } from "bun:test";

const calls: { init?: [string, Record<string, unknown>]; captured: [string, unknown][] } = { captured: [] };
mock.module("posthog-js", () => ({
  default: {
    init: (key: string, config: Record<string, unknown>) => void (calls.init = [key, config]),
    capture: (event: string, props: unknown) => void calls.captured.push([event, props]),
  },
}));
// As the Docker build sets them: a key, and an unset host passed as "".
process.env.VITE_POSTHOG_KEY = "phc_test";
process.env.VITE_POSTHOG_HOST = "";
const { identify, track } = await import("./observability");

describe("PostHog", () => {
  test("starts at identify, as that learner, on the EU host; earlier events wait and then go", async () => {
    track("course_started", { lang: "es" });
    expect(calls.init).toBeUndefined();
    identify("user-1");
    await new Promise((r) => setTimeout(r, 0));
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
    expect(calls.captured).toEqual([["course_started", { lang: "es" }]]);
    track("garden_opened");
    expect(calls.captured.at(-1)).toEqual(["garden_opened", {}]);
  });
});
