// Hardening: only the auth endpoints the app uses are reachable, an anonymous
// session can't be merged into an account without that account's code, and
// logs and error reports carry no tokens, codes or emails.

import { afterAll, describe, expect, test } from "bun:test";
import { scrub } from "../instrument";
import { review, startApp, stopMockLLM, unique, W } from "./helpers";

const t = await startApp();
afterAll(async () => (await t.stop(), stopMockLLM()));

const codeFor = (email: string) => t.mailer.latest(email)!.subject.match(/\d{6}/)![0];
const sendCode = (email: string, cookie?: string) => t.call("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" }, cookie);

describe("auth endpoints: an allow-list", () => {
  const used = ["GET /get-session", "POST /sign-out", "POST /sign-in/anonymous", "POST /email-otp/send-verification-otp", "POST /sign-in/email-otp"];

  test("every other Better Auth endpoint is 404, signed in or not", async () => {
    const cookie = await t.signIn(unique("probe"));
    const all = Object.values(t.app.auth.api as Record<string, { path?: string; options?: { method?: string | string[] } }>)
      .filter((e) => e.path)
      .flatMap((e) => [e.options?.method ?? "GET"].flat().map((m) => `${m === "*" ? "POST" : m} ${e.path!.replace(/:\w+/, "x")}`));
    const unused = all.filter((e) => !used.includes(e));
    // Sanity: the enumeration found what we expect to block.
    for (const e of ["POST /update-user", "POST /change-email", "POST /change-password", "GET /list-sessions", "POST /revoke-other-sessions", "POST /link-social", "POST /delete-user", "POST /sign-up/email", "POST /sign-in/email", "POST /email-otp/reset-password", "POST /delete-anonymous-user"]) expect(unused).toContain(e);
    for (const e of unused) {
      const [method, path] = e.split(" ");
      const res = await fetch(`${t.url}/api/auth${path}`, { method, headers: { cookie, origin: t.config.appUrl, "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify({ name: "x", email: "x@example.com", password: "password123" }) });
      expect({ e, status: res.status }).toEqual({ e, status: 404 });
    }
    // The used ones, with another method, are 404 too.
    expect((await fetch(`${t.url}/api/auth/get-session`, { method: "POST", headers: { cookie, origin: t.config.appUrl } })).status).toBe(404);
    // And the session still works: nothing above changed it.
    expect((await t.call("/api/auth/get-session", undefined, cookie)).body.user.name).not.toBe("x");
  });
});

describe("account linking needs the account's code", () => {
  /** Alice has an account with progress; Mallory studies anonymously and tries to take it. */
  async function setup() {
    const aliceEmail = unique("alice");
    const alice = await t.signIn(aliceEmail);
    const aliceId = (await t.me(alice)).id;
    await t.write(alice, [review(W.a)]);
    const mallory = await t.anonymous();
    const malloryId = (await t.me(mallory)).id;
    await t.write(mallory, [review(W.m)]);
    return { aliceEmail, aliceId, mallory, malloryId };
  }
  async function untouched(aliceId: string, malloryId: string) {
    expect((await t.sql`select word_id from review where user_id = ${aliceId}`).map((r: { word_id: string }) => r.word_id)).toEqual([W.a]);
    expect((await t.sql`select word_id from review where user_id = ${malloryId}`).map((r: { word_id: string }) => r.word_id)).toEqual([W.m]);
    expect((await t.sql`select 1 from "user" where id = ${malloryId}`).length).toBe(1);
  }

  test("guessing fails, and after five tries even the right code is refused", async () => {
    const { aliceEmail, aliceId, mallory, malloryId } = await setup();
    expect((await sendCode(aliceEmail, mallory)).status).toBe(200); // the code goes to Alice, not Mallory
    const real = codeFor(aliceEmail);
    const wrong = real === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const r = await t.call("/api/auth/sign-in/email-otp", { email: aliceEmail, otp: wrong }, mallory);
      expect(r.status).not.toBe(200);
      expect(r.headers.getSetCookie().some((c) => c.includes("session_token=") && !c.includes("session_token=;"))).toBe(false);
    }
    expect((await t.call("/api/auth/sign-in/email-otp", { email: aliceEmail, otp: real }, mallory)).status).not.toBe(200);
    await untouched(aliceId, malloryId);
    expect((await t.me(mallory)).id).toBe(malloryId); // still just Mallory's anonymous session
  });

  test("a code sent to Mallory's own email doesn't work for Alice's", async () => {
    const { aliceEmail, aliceId, mallory, malloryId } = await setup();
    const own = unique("mallory");
    await sendCode(own, mallory);
    expect((await t.call("/api/auth/sign-in/email-otp", { email: aliceEmail, otp: codeFor(own) }, mallory)).status).not.toBe(200);
    await untouched(aliceId, malloryId);
  });
});

describe("no secrets in logs", () => {
  test("sign-in, linking and failures log no tokens, codes or emails", async () => {
    const lines: string[] = [];
    const saved = { log: console.log, error: console.error, warn: console.warn, level: process.env.LOG_LEVEL };
    const capture = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    console.log = console.error = console.warn = capture;
    process.env.LOG_LEVEL = "debug";
    const email = unique("logs");
    let cookie = "";
    const codes: string[] = [];
    try {
      const anon = await t.anonymous();
      await t.write(anon, [review(W.l)]);
      await sendCode(email, anon);
      codes.push(codeFor(email));
      await t.call("/api/auth/sign-in/email-otp", { email, otp: codes[0] === "000000" ? "111111" : "000000" }, anon);
      cookie = await t.signIn(email, anon);
      codes.push(codeFor(email));
      await t.call("/api/me", undefined, cookie);
      await t.call("/api/auth/sign-out", {}, cookie);
      // Better Auth's own logger: only the message and errors get through.
      (await t.app.auth.$context).logger.error("probe", { email }, new Error("boom"));
    } finally {
      Object.assign(console, { log: saved.log, error: saved.error, warn: saved.warn });
      if (saved.level === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = saved.level;
    }
    // The dev outbox prints codes on purpose (it is never used in production).
    const logged = lines.filter((l) => !l.startsWith("[mail]"));
    expect(logged.some((l) => l.includes('"msg":"request"'))).toBe(true);
    expect(logged.some((l) => l.includes('"msg":"auth: probe"') && l.includes("boom"))).toBe(true);
    const token = decodeURIComponent(cookie.match(/session_token=([^;]+)/)![1]);
    for (const secret of [email, token, token.split(".")[0], ...codes]) {
      expect(logged.filter((l) => l.includes(secret))).toEqual([]);
    }
  });
});

describe("wide events", () => {
  test("each request's one line says what happened: signup, code, sign-in, linking, new course, writes", async () => {
    const lines: Record<string, unknown>[] = [];
    const saved = { log: console.log, error: console.error, warn: console.warn, level: process.env.LOG_LEVEL };
    process.env.LOG_LEVEL = "info";
    const capture = (...args: unknown[]) => {
      try {
        lines.push(JSON.parse(String(args[0])));
      } catch {
        // [mail] lines from the dev outbox
      }
    };
    console.log = console.error = console.warn = capture;
    const email = unique("events");
    let anonId = "";
    try {
      const anon = await t.anonymous();
      await t.write(anon, [{ type: "course.upsert", row: { lang: "de", minutes: 5 } }, review(W.l)]);
      await t.write(anon, [{ type: "course.upsert", row: { lang: "de", minutes: 9 } }]);
      anonId = String(lines.find((l) => l.signup === "anonymous")?.userId ?? "");
      await sendCode(email, anon);
      await t.signIn(email, anon);
    } finally {
      Object.assign(console, { log: saved.log, error: saved.error, warn: saved.warn });
      if (saved.level === undefined) delete process.env.LOG_LEVEL;
      else process.env.LOG_LEVEL = saved.level;
    }
    const requests = lines.filter((l) => l.msg === "request");
    const at = (path: string) => requests.filter((l) => l.path === path);
    // Anonymous start: a user, a session, and the user id on that same line.
    expect(at("/api/auth/sign-in/anonymous")[0]).toMatchObject({ signup: "anonymous", signin: "anonymous", status: 200 });
    expect(anonId).not.toBe("");
    // The first write starts the course; the second only changes it.
    const [first, second] = at("/api/write");
    expect(first).toMatchObject({ userId: anonId, courseStarted: "de", writes: 2, writeTypes: "course.upsert:1 review.insert:1", writeChanged: true });
    expect(second.courseStarted).toBeUndefined();
    expect(at("/api/auth/email-otp/send-verification-otp").at(-1)).toMatchObject({ otp: "sent" });
    // Email sign-in from the anonymous session: a new user, signed in, linked.
    expect(at("/api/auth/sign-in/email-otp").at(-1)).toMatchObject({ signup: "email", signin: "email", linkedFrom: anonId, status: 200 });
    for (const l of requests) expect(JSON.stringify(l)).not.toContain(email);
  });
});

describe("error reports", () => {
  test("cookies, auth headers, bodies and user details are scrubbed", () => {
    const event = scrub<import("@sentry/bun").Event>({
      request: {
        url: "https://perennial.example/api/auth/sign-in/email-otp",
        headers: { Cookie: "better-auth.session_token=abc", authorization: "Bearer abc", "user-agent": "test" },
        cookies: { "better-auth.session_token": "abc" },
        data: { email: "alice@example.com", otp: "123456" },
      },
      user: { id: "u1", email: "alice@example.com", ip_address: "1.2.3.4" },
    });
    expect(event.request).toEqual({ url: "https://perennial.example/api/auth/sign-in/email-otp", headers: { "user-agent": "test" } });
    expect(event.user).toEqual({ id: "u1" });
  });
});

describe("one address for the app", () => {
  const host = new URL(t.config.appUrl).host;
  test("www and Railway's domain redirect to APP_URL, path and query kept", async () => {
    for (const alias of [`www.${host}`, "perennial-production.up.railway.app"]) {
      const res = await t.app.fetch(new Request(`https://${alias}/garden?x=1`));
      expect(res.status).toBe(308);
      expect(res.headers.get("location")).toBe(`${t.config.appUrl}/garden?x=1`);
    }
  });

  test("a browser stuck on an old address gets a worker that moves it to APP_URL", async () => {
    for (const alias of [`www.${host}`, "perennial-production.up.railway.app"]) {
      const res = await t.app.fetch(new Request(`https://${alias}/sw.js`));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/javascript");
      const js = await res.text();
      expect(js).toContain("registration.unregister()");
      expect(js).toContain(JSON.stringify(t.config.appUrl));
    }
  });

  test("API answers are never cached by a CDN", async () => {
    const res = await t.app.fetch(new Request(`${t.config.appUrl}/api/server`));
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const missing = await t.app.fetch(new Request(`${t.config.appUrl}/api/nope`));
    expect(missing.headers.get("cache-control")).toBe("no-store");
  });
});
