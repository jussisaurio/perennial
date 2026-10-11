// Abuse protection: email bombing and bot signups.

import { afterAll, describe, expect, test } from "bun:test";
import type { OutboxMailer } from "../src/mail";
import { startApp, stopMockLLM, unique } from "./helpers";

const t = await startApp({ codesPerEmail: { short: 3, day: 10 } });
afterAll(async () => (await t.stop(), stopMockLLM()));

describe("sign-in codes per address", () => {
  test("an address gets a few codes, then silence, from any IP", async () => {
    const email = unique("victim");
    const outbox = (t.app.mailer as OutboxMailer).outbox;
    for (let i = 0; i < 5; i++) {
      const res = await t.call("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" }, undefined, { "x-real-ip": `203.0.113.${i}` });
      expect(res.status).toBe(200); // the same answer: the caller can't tell
    }
    expect(outbox.filter((m) => m.to === email)).toHaveLength(3);
    // Case and spaces don't make a new address.
    await t.call("/api/auth/email-otp/send-verification-otp", { email: email.toUpperCase(), type: "sign-in" });
    expect(outbox.filter((m) => m.to.toLowerCase() === email)).toHaveLength(3);
    // Other addresses are unaffected.
    await t.signIn(unique("bystander"));
  });
});

describe("bot check (Turnstile)", () => {
  test("when configured, new users and codes need a token", async () => {
    const guarded = await startApp({ turnstile: { secretKey: "1x0000000000000000000000000000000AA", siteKey: "1x00000000000000000000AA" } });
    try {
      expect((await guarded.call("/api/auth/sign-in/anonymous", {})).status).toBeGreaterThanOrEqual(400);
      expect((await guarded.call("/api/auth/email-otp/send-verification-otp", { email: unique("bot"), type: "sign-in" })).status).toBeGreaterThanOrEqual(400);
      const page = await fetch(guarded.url + "/health");
      expect(page.headers.get("content-security-policy")).toContain("frame-src https://challenges.cloudflare.com");
    } finally {
      await guarded.stop();
    }
  });
});
