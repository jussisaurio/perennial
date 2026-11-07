import { afterAll, expect, test } from "bun:test";
import { Effect } from "effect";
import { statements } from "../src/migrate";
import { review, startApp, stopMockLLM, unique, W } from "./helpers";

const t = await startApp();
afterAll(async () => (await t.stop(), stopMockLLM()));

test("review inserts are idempotent", async () => {
  const cookie = await t.signIn(unique("write"));
  const r = review(W.a);
  const first = await t.write(cookie, [r]);
  expect(first.status).toBe(200);
  expect((await t.write(cookie, [r])).status).toBe(200); // a retry changes nothing
  const id = (await t.me(cookie)).id;
  expect((await t.sql`select count(*)::int as n from review where user_id = ${id}`)[0]?.n).toBe(1);
});

test("writes say whether anything changed", async () => {
  const cookie = await t.signIn(unique("noop"));
  const r = review(W.i);
  expect((await t.write(cookie, [r])).body).toMatchObject({ changed: true });
  const again = await t.write(cookie, [r]); // a retried insert
  expect(again.status).toBe(200);
  expect(again.body).toMatchObject({ changed: false });
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
  const older = await t.write(cookie, [{ type: "word_state.upsert", row: { word_id: W.d, status: "ignored", updated_at: at(-5000) } }]); // older: loses
  // The answer has the row the server kept, so the device can take it.
  expect(older.body).toMatchObject({ changed: false, stored: { course: [], word_state: [{ word_id: W.d, status: "paused" }] } });
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
  // The learner's other devices read it.
  const res = await t.call("/api/rows", undefined, cookie);
  expect(res.status).toBe(200);
  const rows = res.body.course as { lang: string; door_open: boolean }[];
  expect(rows.map((r) => [r.lang, r.door_open]).sort()).toEqual([["de", false], ["es", true]]);
});

test("a word's forms are stored as a list, which is what the app reads", async () => {
  const cookie = await t.signIn(unique("forms"));
  const id = crypto.randomUUID();
  expect((await t.write(cookie, [{ type: "user_word.upsert", row: { id, lang: "es", lemma: "zorro", gloss: "fox", forms: ["zorro", "zorros"] } }])).status).toBe(200);
  const [row] = await t.sql<{ kind: string; forms: unknown }>`select jsonb_typeof(forms) as kind, forms from user_word where id = ${id}`;
  expect(row).toEqual({ kind: "array", forms: ["zorro", "zorros"] });
});

test("migration 0004 turns forms stored as a JSON string into the list, and the app reads it (#337)", async () => {
  const cookie = await t.signIn(unique("forms-string"));
  const user = (await t.me(cookie)).id;
  const id = crypto.randomUUID();
  const forms = ["zorro", "zorros"];
  // As /api/write stored forms before #340: a jsonb string holding the list's JSON text.
  await t.sql`insert into user_word (id, user_id, lang, lemma, gloss, forms) values (${id}, ${user}, 'es', 'zorro', 'fox', to_jsonb(${JSON.stringify(forms)}::text))`;
  const read = async () => (await t.sql<{ kind: string; forms: unknown }>`select jsonb_typeof(forms) as kind, forms from user_word where id = ${id}`)[0];
  expect(await read()).toEqual({ kind: "string", forms: JSON.stringify(forms) });

  const migration = await Bun.file(new URL("../migrations/0004_user_word_forms_list.sql", import.meta.url)).text();
  // Twice: a rerun (say, a later cleanup migration) changes nothing.
  for (let i = 0; i < 2; i++) for (const statement of statements(migration)) await Effect.runPromise(t.db.unsafe(statement));
  expect(await read()).toEqual({ kind: "array", forms });

  const rows = (await t.call("/api/rows", undefined, cookie)).body.user_word as { id: string; forms: unknown }[];
  expect(rows.map((r) => [r.id, r.forms])).toEqual([[id, forms]]);
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
