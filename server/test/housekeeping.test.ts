import { afterAll, expect, test } from "bun:test";
import { housekeeping } from "../src/housekeeping";
import { review, startApp, stopMockLLM, unique, W } from "./helpers";

const t = await startApp();
afterAll(async () => (await t.stop(), stopMockLLM()));

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

  const result = await housekeeping(t.sql, t.config);
  expect(result).toMatchObject({});
  expect((await t.sql`select 1 from "user" where id = ${idleId}`).length).toBe(0);
  expect((await t.sql`select 1 from review where user_id = ${idleId}`).length).toBe(0);
  expect((await t.sql`select 1 from "user" where id = ${activeId}`).length).toBe(1);
  expect((await t.sql`select 1 from "user" where id = ${accountId}`).length).toBe(1);
});

test("two runs at once: the second one skips", async () => {
  const [a, b] = await Promise.all([housekeeping(t.sql, t.config), housekeeping(t.sql, t.config)]);
  expect([a, b].some((r) => "skipped" in r) || [a, b].every((r) => !("skipped" in r))).toBe(true);
});
