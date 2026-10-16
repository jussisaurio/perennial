import { afterAll, expect, test } from "bun:test";
import { review, startApp, stopMockLLM, unique, W, word } from "./helpers";

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
  await t.sendCode(email);
  const r = await t.call("/api/auth/sign-in/email-otp", { email, otp: "000000" });
  expect(r.status).not.toBe(200);
});

test("anonymous progress moves into the account on sign-in, merged with what it already has", async () => {
  const email = unique("merge");
  // The account already exists, with progress from another device.
  const account = await t.signIn(email);
  const accountId = (await t.me(account)).id;
  const shared = review(W.a);
  await t.write(account, [shared, { type: "course.upsert", row: { lang: "es", minutes: 10 } }, { type: "word_state.upsert", row: { word_id: W.b, status: "paused", updated_at: new Date(Date.now() - 60_000).toISOString() } }]);

  // Meanwhile, on a new device, someone studies without an account.
  const anon = await t.anonymous();
  const anonId = (await t.me(anon)).id;
  expect((await t.me(anon)).anonymous).toBe(true);
  await t.write(anon, [
    review(W.c),
    shared, // the same review id must not be counted twice
    { type: "course.upsert", row: { lang: "es", minutes: 5, door_open: true } },
    { type: "word_state.upsert", row: { word_id: W.b, status: "queued", updated_at: new Date().toISOString() } },
  ]);

  // Signing in from the anonymous session links the two.
  const linked = await t.signIn(email, anon);
  expect((await t.me(linked)).id).toBe(accountId);
  const reviews = await t.sql<{ word_id: string }>`select word_id from review where user_id = ${accountId} order by word_id`;
  expect(reviews.map((r) => r.word_id).sort()).toEqual([W.a, W.c].sort());
  const [course] = await t.sql`select minutes, door_open from course where user_id = ${accountId}`;
  expect(course?.minutes).toBe(10); // the account's own settings win
  expect(course?.door_open).toBe(true); // but a door opened without an account stays open (#315)
  const [state] = await t.sql`select status from word_state where user_id = ${accountId} and word_id = ${W.b}`;
  expect(state?.status).toBe("queued"); // the newer change wins
  expect((await t.sql`select 1 from "user" where id = ${anonId}`).length).toBe(0); // anonymous user gone
});

test("the garden's bowl and shelf (#351) move into the account on sign-in, merged with the account's", async () => {
  const email = unique("left-merge");
  const today = Math.floor(Date.now() / 86_400_000);
  const empty = { n: 0, bowl: null, kept: [], hooks: [null, null, null], arranged: 0 };
  // The account found a feather in its Spanish garden.
  const account = await t.signIn(email);
  const accountId = (await t.me(account)).id;
  const feather = { n: 1, bowl: { thing: "crumbs", day: today - 9, seen: today - 8, found: true }, kept: ["feather"], hooks: ["feather", null, null], arranged: 1 };
  await t.write(account, [{ type: "course.upsert", row: { lang: "es", garden_left: feather } }]);
  // Without an account, on another device: crumbs left twice in Spanish, with a button found the first time; and a German bowl.
  const anon = await t.anonymous();
  const crumbs = { n: 2, bowl: { thing: "crumbs", day: today - 1, seen: null, found: false }, kept: ["button"], hooks: [null, null, null], arranged: 0 };
  const de = { ...empty, n: 1, bowl: { thing: "crumbs", day: today, seen: null, found: false } };
  await t.write(anon, [{ type: "course.upsert", row: { lang: "es", garden_left: crumbs } }, { type: "course.upsert", row: { lang: "de", garden_left: de } }]);
  await t.signIn(email, anon);
  const rows = await t.sql<{ lang: string; garden_left: unknown }>`select lang, garden_left from course where user_id = ${accountId} order by lang`;
  expect(rows.map((r) => [r.lang, r.garden_left])).toEqual([
    ["de", de],
    // The newest thing left, everything kept, and the arrangement made last.
    ["es", { n: 2, bowl: crumbs.bowl, kept: ["feather", "button"], hooks: ["feather", null, null], arranged: 1 }],
  ]);
});

test("a write racing the sign-in is moved into the account or refused, never silently lost", async () => {
  const email = unique("race");
  await t.signIn(email);
  const anon = await t.anonymous();
  await t.write(anon, [review(W.e)]);
  // Code sent first, so the writes race only the linking itself.
  await t.sendCode(email, anon);
  const otp = t.codeFor(email);
  // W.f to W.j
  const racing = Array.from({ length: 5 }, (_, i) => review(word(5 + i)));
  const [link, ...writes] = await Promise.all([t.call("/api/auth/sign-in/email-otp", { email, otp }, anon), ...racing.map((r) => t.write(anon, [r]))]);
  expect(link.status).toBe(200);
  const accountId = (await t.me(link.cookie!)).id;
  const kept = new Set((await t.sql<{ id: string }>`select id from review where user_id = ${accountId}`).map((r) => r.id));
  writes.forEach((w, i) => {
    expect([200, 401]).toContain(w.status);
    if (w.status === 200) expect(kept.has(racing[i]?.row.id ?? "")).toBe(true);
  });
  // After linking, the anonymous cookie can't write rows that would vanish.
  expect((await t.write(anon, [review(W.k)])).status).toBe(401);
});

test("deleting an account removes everything", async () => {
  const cookie = await t.signIn(unique("delete"));
  const id = (await t.me(cookie)).id;
  await t.write(cookie, [review(W.d)]);
  expect((await t.call("/api/account/delete", {}, cookie)).status).toBe(200);
  expect((await t.sql`select 1 from review where user_id = ${id}`).length).toBe(0);
  expect((await t.call("/api/me", undefined, cookie)).status).toBe(401);
});
