import { afterAll, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { AppConfig } from "../src/config";
import { Housekeeping, HousekeepingLive } from "../src/housekeeping";
import { LoggerLive } from "../src/log";
import { review, startApp, stopMockLLM, unique, W } from "./helpers";

const t = await startApp();
afterAll(async () => (await t.stop(), stopMockLLM()));

/** One run, as the cron job does it. */
const housekeeping = () =>
  Effect.runPromise(Effect.flatMap(Housekeeping, (h) => h.run()).pipe(Effect.provide(HousekeepingLive.pipe(Layer.provide(Layer.succeed(AppConfig, t.config)), Layer.provideMerge(LoggerLive)))));

test("inactive anonymous learners are deleted with their data; active ones and accounts stay", async () => {
  const idle = await t.anonymous();
  const idleId = (await t.me(idle)).id;
  await t.write(idle, [review(W.a)]);
  const active = await t.anonymous();
  const activeId = (await t.me(active)).id;
  const account = await t.signIn(unique("kept"));
  const accountId = (await t.me(account)).id;

  // Age everyone; then the active learner renews a session today.
  const old = new Date(Date.now() - 90 * 86_400_000);
  await t.sql`update "user" set "createdAt" = ${old} where id in ${t.sql([idleId, activeId, accountId])}`;
  await t.sql`update "session" set "updatedAt" = ${old} where "userId" in ${t.sql([idleId, accountId])}`;

  await housekeeping();
  expect((await t.sql`select 1 from "user" where id = ${idleId}`).length).toBe(0);
  expect((await t.sql`select 1 from review where user_id = ${idleId}`).length).toBe(0);
  expect((await t.sql`select 1 from "user" where id = ${activeId}`).length).toBe(1);
  expect((await t.sql`select 1 from "user" where id = ${accountId}`).length).toBe(1);
});

test("a second run while one holds the lock skips, and runs again once it is free", async () => {
  const other = await t.sql.reserve(); // the first run's connection
  try {
    expect((await other`select pg_try_advisory_lock(727002) as locked`)[0].locked).toBe(true);
    expect(await housekeeping()).toEqual({ skipped: true });
  } finally {
    await other`select pg_advisory_unlock(727002)`;
    other.release();
  }
  expect(await housekeeping()).not.toEqual({ skipped: true });
});

test("per-IP rate-limit counters older than an hour are deleted", async () => {
  const old = `198.51.100.${Math.floor(Math.random() * 200)}/sign-in/anonymous-${unique("old")}`;
  const fresh = `198.51.100.${Math.floor(Math.random() * 200)}/sign-in/anonymous-${unique("fresh")}`;
  await t.sql`insert into "rateLimit" (key, count, "lastRequest") values (${old}, 3, ${Date.now() - 2 * 3_600_000}), (${fresh}, 1, ${Date.now()})`;
  await housekeeping();
  expect((await t.sql`select key from "rateLimit" where key in ${t.sql([old, fresh])}`).map((r: { key: string }) => r.key)).toEqual([fresh]);
});
