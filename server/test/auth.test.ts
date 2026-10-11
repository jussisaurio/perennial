import { afterAll, expect, test } from "bun:test";
import { startApp, stopMockLLM } from "./helpers";

const t = await startApp();
afterAll(() => (t.stop(), stopMockLLM()));

test("sign in with an emailed code, then fetch the account", async () => {
  expect((await t.call("/api/auth/code", { email: "Ana@Example.com " })).status).toBe(200);
  const mail = t.mailer.latest("ana@example.com")!;
  expect(mail.subject).toMatch(/^\d{6} is your Perennial code$/);
  const code = mail.subject.slice(0, 6);

  const bad = await t.call("/api/auth/verify", { email: "ana@example.com", code: code === "000000" ? "111111" : "000000" });
  expect(bad.body.error).toBe("wrong_code");

  const ok = await t.call("/api/auth/verify", { email: "ana@example.com", code });
  expect(ok.status).toBe(200);
  expect(ok.body.me).toMatchObject({ email: "ana@example.com", plan: "free", credits: { used: 0, limit: 25 } });

  const me = await t.call("/api/me", undefined, ok.body.token);
  expect(me.body.email).toBe("ana@example.com");

  // A code works once.
  expect((await t.call("/api/auth/verify", { email: "ana@example.com", code })).body.error).toBe("code_expired");

  await t.call("/api/auth/signout", {}, ok.body.token);
  expect((await t.call("/api/me", undefined, ok.body.token)).status).toBe(401);
});

test("brute force and spam are limited", async () => {
  await t.call("/api/auth/code", { email: "bob@example.com" });
  for (let i = 0; i < 5; i++) await t.call("/api/auth/verify", { email: "bob@example.com", code: "999999" });
  const code = t.mailer.latest("bob@example.com")!.subject.slice(0, 6);
  expect((await t.call("/api/auth/verify", { email: "bob@example.com", code })).body.error).toBe("too_many_attempts");

  for (let i = 0; i < 4; i++) await t.call("/api/auth/code", { email: "bob@example.com" });
  expect((await t.call("/api/auth/code", { email: "bob@example.com" })).status).toBe(429);
  expect((await t.call("/api/auth/code", { email: "not-an-email" })).body.error).toBe("invalid_email");
});

test("deleting an account removes it and its synced data", async () => {
  const token = await t.signIn("gone@example.com");
  await t.call("/sync", { cursor: 0, ops: [{ id: "o1", hlc: "0000000000001:0000:a", table: "reviews", rowId: "o1", patch: {} }] }, undefined, { authorization: `Session ${token}` });
  expect((await t.call("/api/account/delete", { confirm: "nope" }, token)).status).toBe(400);
  expect((await t.call("/api/account/delete", { confirm: "delete" }, token)).body.ok).toBe(true);
  expect((await t.call("/api/me", undefined, token)).status).toBe(401);
  const again = await t.signIn("gone@example.com"); // a fresh, empty account
  const r = await t.call("/sync", { cursor: 0, ops: [] }, undefined, { authorization: `Session ${again}` });
  expect(r.body.ops).toEqual([]);
});

test("the dev outbox endpoint exposes the latest code", async () => {
  await t.call("/api/auth/code", { email: "dev@example.com" });
  const r = await t.call("/api/dev/outbox?email=dev@example.com");
  expect(r.body.code).toMatch(/^\d{6}$/);
});
