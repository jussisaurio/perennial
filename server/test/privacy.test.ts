import { afterAll, expect, test } from "bun:test";
import { SESSION_IDLE_MS } from "../src/auth";
import { startApp, stopMockLLM } from "./helpers";

const t = await startApp();
afterAll(() => (t.stop(), stopMockLLM()));

const DAY = 86_400_000;
const hlc = (ms: number, n = 0) => `${String(ms).padStart(13, "0")}:${String(n).padStart(4, "0")}:dev`;
const op = (id: string, ms: number, table: string, rowId: string, patch: Record<string, unknown>) => ({ id, hlc: hlc(ms), table, rowId, patch });
const pull = async (auth: string) => (await t.call("/sync", { cursor: 0, ops: [] }, undefined, { authorization: auth })).body.ops as { rowId: string; patch: Record<string, unknown> }[];

test("long-deleted words are forgotten on the server, keeping only a tombstone", async () => {
  const token = await t.signIn("forget@example.com");
  const auth = `Session ${token}`;
  const old = Date.now() - 40 * DAY;
  await t.call("/sync", {
    cursor: 0,
    ops: [
      op("1", old, "lexemes", "w1", { courseId: "c", lemma: "secreto", gloss: "secret" }),
      op("2", old, "examples", "e1", { courseId: "c", lexemeId: "w1", text: "Mi secreto personal." }),
      op("3", old, "reviews", "r1", { courseId: "c", lexemeId: "w1", grade: 3 }),
      op("4", old + 1, "lexemes", "w1", { deleted: old + 1 }),
      op("5", old, "lexemes", "w2", { courseId: "c", lemma: "casa", gloss: "house" }),
      // Deleted recently: still within the undo / offline window, kept.
      op("6", Date.now(), "lexemes", "w2", { deleted: Date.now() }),
    ],
  }, undefined, { authorization: auth });

  const r = t.app.maintain();
  expect(r.rows).toBe(3); // the word, its sentence, its review

  const ops = await pull(auth);
  const text = JSON.stringify(ops);
  expect(text).not.toContain("secreto");
  expect(text).not.toContain("Mi secreto personal");
  expect(ops.filter((o) => o.rowId === "w1")).toEqual([expect.objectContaining({ patch: { deleted: old + 1 } })]);
  expect(text).toContain("casa"); // recent deletion untouched
});

test("an undone deletion is not compacted", async () => {
  const token = await t.signIn("undo@example.com");
  const old = Date.now() - 40 * DAY;
  await t.call("/sync", { cursor: 0, ops: [op("u1", old, "lexemes", "w", { lemma: "perro" }), op("u2", old + 1, "lexemes", "w", { deleted: old + 1 }), op("u3", old + 2, "lexemes", "w", { deleted: 0 })] }, undefined, { authorization: `Session ${token}` });
  t.app.maintain();
  expect(JSON.stringify(await pull(`Session ${token}`))).toContain("perro");
});

test("sessions expire after 90 days without use", async () => {
  const token = await t.signIn("idle@example.com");
  const req = new Request("http://x", { headers: { authorization: `Session ${token}` } });
  expect(t.app.auth.authenticate(req)).not.toBeNull();
  expect(t.app.auth.authenticate(req, Date.now() + SESSION_IDLE_MS + DAY)).toBeNull();
  expect((await t.call("/api/me", undefined, token)).status).toBe(401); // and it's gone for good
});
