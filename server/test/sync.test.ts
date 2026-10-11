import { afterAll, expect, test } from "bun:test";
import { review, startApp, stopMockLLM, unique } from "./helpers";

const t = await startApp();
afterAll(async () => (await t.stop(), stopMockLLM()));

test("writes return the Postgres transaction id; review inserts are idempotent", async () => {
  const cookie = await t.signIn(unique("write"));
  const r = review("es.w.aaaaaaaaaa");
  const first = await t.write(cookie, [r]);
  expect(first.status).toBe(200);
  expect(typeof first.body.txid).toBe("number");
  expect((await t.write(cookie, [r])).status).toBe(200); // a retry changes nothing
  const id = (await t.me(cookie)).id;
  expect((await t.sql`select count(*)::int as n from review where user_id = ${id}`)[0].n).toBe(1);
});

test("a learner can never touch another learner's rows", async () => {
  const alice = await t.signIn(unique("alice"));
  const mallory = await t.signIn(unique("mallory"));
  const r = review("es.w.bbbbbbbbbb");
  await t.write(alice, [r]);
  // Same id from someone else: ignored, not an overwrite. Deleting it: no effect.
  await t.write(mallory, [{ ...r, row: { ...r.row, grade: 1 } }, { type: "review.delete", id: r.row.id }]);
  const [row] = await t.sql`select grade, user_id from review where id = ${r.row.id}`;
  expect(row.grade).toBe(3);
  expect(row.user_id).toBe((await t.me(alice)).id);
});

test("Undo deletes the review", async () => {
  const cookie = await t.signIn(unique("undo"));
  const r = review("es.w.cccccccccc");
  await t.write(cookie, [r]);
  await t.write(cookie, [{ type: "review.delete", id: r.row.id }]);
  expect((await t.sql`select 1 from review where id = ${r.row.id}`).length).toBe(0);
});

test("word state: the newer change wins, and the server caps future times", async () => {
  const cookie = await t.signIn(unique("state"));
  const id = (await t.me(cookie)).id;
  const at = (ms: number) => new Date(Date.now() + ms).toISOString();
  await t.write(cookie, [{ type: "word_state.upsert", row: { word_id: "es.w.dddddddddd", status: "paused", updated_at: at(-1000) } }]);
  await t.write(cookie, [{ type: "word_state.upsert", row: { word_id: "es.w.dddddddddd", status: "ignored", updated_at: at(-5000) } }]); // older: loses
  expect((await t.sql`select status from word_state where user_id = ${id}`)[0].status).toBe("paused");
  // A device with a fast clock cannot win every later conflict.
  await t.write(cookie, [{ type: "word_state.upsert", row: { word_id: "es.w.dddddddddd", status: "queued", updated_at: at(10 * 86_400_000) } }]);
  const [row] = await t.sql`select updated_at from word_state where user_id = ${id}`;
  expect(new Date(row.updated_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
});

test("course settings change per column", async () => {
  const cookie = await t.signIn(unique("course"));
  const id = (await t.me(cookie)).id;
  await t.write(cookie, [{ type: "course.upsert", row: { lang: "de" } }]);
  await t.write(cookie, [{ type: "course.upsert", row: { lang: "de", minutes: 12 } }]);
  await t.write(cookie, [{ type: "course.upsert", row: { lang: "de", retention: 0.85 } }]);
  const [row] = await t.sql`select minutes, retention from course where user_id = ${id}`;
  expect(row.minutes).toBe(12);
  expect(row.retention).toBeCloseTo(0.85);
});

test("bad batches are rejected whole; reviews from the future too", async () => {
  const cookie = await t.signIn(unique("bad"));
  expect((await t.write(cookie, [{ type: "review.insert", row: { id: "nope" } }])).status).toBe(422);
  expect((await t.write(cookie, [review("es.w.eeeeeeeeee", { reviewed_at: new Date(Date.now() + 3 * 86_400_000).toISOString() })])).status).toBe(422);
  expect((await t.call("/api/write", { mutations: [review("x")] })).status).toBe(401);
});

test("old clients are told to reload before writing", async () => {
  const strict = await startApp({ minClientVersion: "2.0.0" });
  const cookie = await strict.signIn(unique("old"));
  const old = await strict.call("/api/write", { mutations: [review("es.w.ffffffffff")] }, cookie, { "x-perennial-version": "1.9.9" });
  expect(old.status).toBe(426);
  expect(old.body).toMatchObject({ error: "please_reload", minVersion: "2.0.0" });
  const fresh = await strict.call("/api/write", { mutations: [review("es.w.ffffffffff")] }, cookie, { "x-perennial-version": "2.0.0" });
  expect(fresh.status).toBe(200);
  await strict.stop();
});

test("shapes stream only the learner's own rows, whatever the client asks for", async () => {
  const alice = await t.signIn(unique("shape-a"));
  const bob = await t.signIn(unique("shape-b"));
  await t.write(alice, [review("es.w.gggggggggg")]);
  await t.write(bob, [review("es.w.hhhhhhhhhh")]);
  // A sneaky client tries to widen the shape.
  const res = await t.call("/api/shape?table=review&offset=-1&where=true", undefined, bob);
  expect(res.status).toBe(200);
  const rows = (res.body as { value?: { word_id: string } }[]).filter((m) => m.value).map((m) => m.value!.word_id);
  expect(rows).toContain("es.w.hhhhhhhhhh");
  expect(rows).not.toContain("es.w.gggggggggg");
  expect(res.headers.get("vary")).toContain("cookie");
  expect(res.headers.get("cache-control") ?? "").not.toContain("public");
  expect((await t.call("/api/shape?table=user&offset=-1", undefined, bob)).status).toBe(400);
  expect((await t.call("/api/shape?table=review&offset=-1")).status).toBe(401);
});
