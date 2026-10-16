import { afterAll, expect, test } from "bun:test";
import { review, startApp, stopMockLLM, unique, W } from "./helpers";

const t = await startApp();
afterAll(async () => (await t.stop(), stopMockLLM()));

test("writes return the Postgres transaction id; review inserts are idempotent", async () => {
  const cookie = await t.signIn(unique("write"));
  const r = review(W.a);
  const first = await t.write(cookie, [r]);
  expect(first.status).toBe(200);
  expect(typeof first.body.txid).toBe("number");
  expect((await t.write(cookie, [r])).status).toBe(200); // a retry changes nothing
  const id = (await t.me(cookie)).id;
  expect((await t.sql`select count(*)::int as n from review where user_id = ${id}`)[0]?.n).toBe(1);
});

test("writes say whether anything changed, so the client doesn't wait for an echo that won't come", async () => {
  const cookie = await t.signIn(unique("noop"));
  const r = review(W.i);
  expect((await t.write(cookie, [r])).body).toMatchObject({ changed: true });
  const again = await t.write(cookie, [r]); // a retried insert
  expect(again.status).toBe(200);
  expect(again.body).toMatchObject({ changed: false });
  expect(typeof again.body.txid).toBe("number");
  expect((await t.write(cookie, [{ type: "review.delete", id: crypto.randomUUID() }])).body.changed).toBe(false);
});

test("Undo deletes the review", async () => {
  const cookie = await t.signIn(unique("undo"));
  const r = review(W.c);
  await t.write(cookie, [r]);
  await t.write(cookie, [{ type: "review.delete", id: r.row.id }]);
  expect((await t.sql`select 1 from review where id = ${r.row.id}`).length).toBe(0);
});

test("word state: the newer change wins, and the server caps future times", async () => {
  const cookie = await t.signIn(unique("state"));
  const id = (await t.me(cookie)).id;
  const at = (ms: number) => new Date(Date.now() + ms).toISOString();
  await t.write(cookie, [{ type: "word_state.upsert", row: { word_id: W.d, status: "paused", updated_at: at(-1000) } }]);
  await t.write(cookie, [{ type: "word_state.upsert", row: { word_id: W.d, status: "ignored", updated_at: at(-5000) } }]); // older: loses
  expect((await t.sql`select status from word_state where user_id = ${id}`)[0]?.status).toBe("paused");
  // A device with a fast clock cannot win every later conflict.
  await t.write(cookie, [{ type: "word_state.upsert", row: { word_id: W.d, status: "queued", updated_at: at(10 * 86_400_000) } }]);
  const [row] = await t.sql<{ updated_at: Date }>`select updated_at from word_state where user_id = ${id}`;
  expect(row?.updated_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
});

test("course settings change per column", async () => {
  const cookie = await t.signIn(unique("course"));
  const id = (await t.me(cookie)).id;
  await t.write(cookie, [{ type: "course.upsert", row: { lang: "de" } }]);
  await t.write(cookie, [{ type: "course.upsert", row: { lang: "de", minutes: 12 } }]);
  await t.write(cookie, [{ type: "course.upsert", row: { lang: "de", retention: 0.85 } }]);
  const [row] = await t.sql`select minutes, retention from course where user_id = ${id}`;
  expect(row?.minutes).toBe(12);
  expect(row?.retention).toBeCloseTo(0.85);
});

test("the orchard door opens for good, per course, and syncs to the learner's devices (#315)", async () => {
  const cookie = await t.signIn(unique("door"));
  const id = (await t.me(cookie)).id;
  const door = async (lang: string) => (await t.sql`select door_open from course where user_id = ${id} and lang = ${lang}`)[0]?.door_open;
  // A new course row, as the app inserts it, starts closed.
  await t.write(cookie, [{ type: "course.upsert", row: { lang: "es", minutes: 5, retention: 0.9, door_open: false } }]);
  expect(await door("es")).toBe(false);
  await t.write(cookie, [{ type: "course.upsert", row: { lang: "es", door_open: true } }]);
  expect(await door("es")).toBe(true);
  // A settings change from another device, and a device that still has it closed: it stays open.
  await t.write(cookie, [{ type: "course.upsert", row: { lang: "es", retention: 0.85 } }]);
  await t.write(cookie, [{ type: "course.upsert", row: { lang: "es", door_open: false } }]);
  expect(await door("es")).toBe(true);
  // The German garden's door is its own.
  await t.write(cookie, [{ type: "course.upsert", row: { lang: "de" } }]);
  expect(await door("de")).toBe(false);
  expect((await t.write(cookie, [{ type: "course.upsert", row: { lang: "es", door_open: "yes" } }])).status).toBe(422);
  // The course shape carries it to the learner's other devices.
  const res = await t.call("/api/shape?table=course&offset=-1", undefined, cookie);
  expect(res.status).toBe(200);
  // Electric sends values as text; the app's Electric client parses them.
  const rows = (res.body as { value?: { lang: string; door_open: string } }[]).filter((m) => m.value).map((m) => m.value!);
  expect(rows.map((r) => [r.lang, r.door_open]).sort()).toEqual([["de", "false"], ["es", "true"]]);
});

test("a word's forms are stored as a list, which is what the app reads from the stream", async () => {
  const cookie = await t.signIn(unique("forms"));
  const id = crypto.randomUUID();
  expect((await t.write(cookie, [{ type: "user_word.upsert", row: { id, lang: "es", lemma: "zorro", gloss: "fox", forms: ["zorro", "zorros"] } }])).status).toBe(200);
  const [row] = await t.sql<{ kind: string; forms: unknown }>`select jsonb_typeof(forms) as kind, forms from user_word where id = ${id}`;
  expect(row).toEqual({ kind: "array", forms: ["zorro", "zorros"] });
});

test("bad batches are rejected whole; reviews from the future too", async () => {
  const cookie = await t.signIn(unique("bad"));
  expect((await t.write(cookie, [{ type: "review.insert", row: { id: "nope" } }])).status).toBe(422);
  expect((await t.write(cookie, [review(W.e, { reviewed_at: new Date(Date.now() + 3 * 86_400_000).toISOString() })])).status).toBe(422);
});

test("old clients are told to reload before writing", async () => {
  const strict = await startApp({ minClientVersion: "2.0.0" });
  const cookie = await strict.signIn(unique("old"));
  const old = await strict.call("/api/write", { mutations: [review(W.f)] }, cookie, { "x-perennial-version": "1.9.9" });
  expect(old.status).toBe(426);
  expect(old.body).toMatchObject({ error: "please_reload", minVersion: "2.0.0" });
  const fresh = await strict.call("/api/write", { mutations: [review(W.f)] }, cookie, { "x-perennial-version": "2.0.0" });
  expect(fresh.status).toBe(200);
  await strict.stop();
});

test("shapes stream only the learner's own rows, whatever the client asks for", async () => {
  const alice = await t.signIn(unique("shape-a"));
  const bob = await t.signIn(unique("shape-b"));
  await t.write(alice, [review(W.g)]);
  await t.write(bob, [review(W.h)]);
  // A sneaky client tries to widen the shape.
  const res = await t.call("/api/shape?table=review&offset=-1&where=true", undefined, bob);
  expect(res.status).toBe(200);
  const rows = (res.body as { value?: { word_id: string } }[]).filter((m) => m.value).map((m) => m.value!.word_id);
  expect(rows).toContain(W.h);
  expect(rows).not.toContain(W.g);
  expect(res.headers.get("vary")).toContain("cookie");
  expect(res.headers.get("cache-control") ?? "").not.toContain("public");
  expect((await t.call("/api/shape?table=user&offset=-1", undefined, bob)).status).toBe(400);
  expect((await t.call("/api/shape?table=review&offset=-1")).status).toBe(401);
});
