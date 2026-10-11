import { afterAll, expect, test } from "bun:test";
import { review, startApp, stopMockLLM, unique } from "./helpers";

const t = await startApp();
afterAll(async () => (await t.stop(), stopMockLLM()));

test("email code sign-in: a cookie session, no password", async () => {
  const email = unique("otp");
  const cookie = await t.signIn(email);
  expect(cookie).toContain("session_token");
  const me = await t.me(cookie);
  expect(me).toMatchObject({ email, anonymous: false });
  expect((await t.call("/api/me")).status).toBe(401);
});

test("a wrong code does not sign in", async () => {
  const email = unique("wrong");
  await t.call("/api/auth/email-otp/send-verification-otp", { email, type: "sign-in" });
  const r = await t.call("/api/auth/sign-in/email-otp", { email, otp: "000000" });
  expect(r.status).not.toBe(200);
});

test("anonymous progress moves into the account on sign-in, merged with what it already has", async () => {
  const email = unique("merge");
  // The account already exists, with progress from another device.
  const account = await t.signIn(email);
  const accountId = (await t.me(account)).id;
  const shared = review("es.w.aaaaaaaaaa");
  await t.write(account, [shared, { type: "course.upsert", row: { lang: "es", minutes: 10 } }, { type: "word_state.upsert", row: { word_id: "es.w.bbbbbbbbbb", status: "paused", updated_at: new Date(Date.now() - 60_000).toISOString() } }]);

  // Meanwhile, on a new device, someone studies without an account.
  const anon = await t.anonymous();
  const anonId = (await t.me(anon)).id;
  expect((await t.me(anon)).anonymous).toBe(true);
  await t.write(anon, [
    review("es.w.cccccccccc"),
    shared, // the same review id must not be counted twice
    { type: "course.upsert", row: { lang: "es", minutes: 5 } },
    { type: "word_state.upsert", row: { word_id: "es.w.bbbbbbbbbb", status: "queued", updated_at: new Date().toISOString() } },
  ]);

  // Signing in from the anonymous session links the two.
  const linked = await t.signIn(email, anon);
  expect((await t.me(linked)).id).toBe(accountId);
  const reviews = await t.sql`select word_id from review where user_id = ${accountId} order by word_id`;
  expect(reviews.map((r: { word_id: string }) => r.word_id)).toEqual(["es.w.aaaaaaaaaa", "es.w.cccccccccc"]);
  const [course] = await t.sql`select minutes from course where user_id = ${accountId}`;
  expect(course.minutes).toBe(10); // the account's own settings win
  const [state] = await t.sql`select status from word_state where user_id = ${accountId} and word_id = 'es.w.bbbbbbbbbb'`;
  expect(state.status).toBe("queued"); // the newer change wins
  expect((await t.sql`select 1 from "user" where id = ${anonId}`).length).toBe(0); // anonymous user gone
});

test("deleting an account removes everything", async () => {
  const cookie = await t.signIn(unique("delete"));
  const id = (await t.me(cookie)).id;
  await t.write(cookie, [review("es.w.dddddddddd")]);
  expect((await t.call("/api/account/delete", {}, cookie)).status).toBe(200);
  expect((await t.sql`select 1 from review where user_id = ${id}`).length).toBe(0);
  expect((await t.call("/api/me", undefined, cookie)).status).toBe(401);
});
