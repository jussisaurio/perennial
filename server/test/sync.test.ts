import { afterAll, expect, test } from "bun:test";
import { startApp, stopMockLLM } from "./helpers";

const t = await startApp();
afterAll(() => (t.stop(), stopMockLLM()));

const op = (id: string) => ({ id, hlc: "0000000000001:0000:a", table: "reviews", rowId: id, patch: {} });
const sync = (auth: string, body: unknown) => t.call("/sync", body, undefined, { authorization: auth });

test("sync code: push, pull, idempotence, namespaces", async () => {
  const A = "Bearer aaaaa-bbbbb-ccccc";
  let r = (await sync(A, { cursor: 0, ops: [op("1"), op("2")] })).body;
  expect(r.ops.map((o: { id: string }) => o.id)).toEqual(["1", "2"]);
  r = (await sync(A, { cursor: r.cursor, ops: [op("2"), op("3")] })).body;
  expect(r.ops.map((o: { id: string }) => o.id)).toEqual(["3"]);
  expect((await sync("Bearer zzzzz-yyyyy-xxxxx", { cursor: 0, ops: [] })).body.ops).toEqual([]);
  expect((await sync("Bearer short", { cursor: 0, ops: [] })).status).toBe(401);
  expect((await sync(A, { cursor: 0, ops: [{ nope: 1 }] })).status).toBe(400);
});

test("signed-in users sync under their account on every device", async () => {
  const token = await t.signIn("sync@example.com");
  const auth = `Session ${token}`;
  await sync(auth, { cursor: 0, ops: [op("x1")] });
  const token2 = await t.signIn("sync@example.com"); // second device
  const r = (await sync(`Session ${token2}`, { cursor: 0, ops: [] })).body;
  expect(r.ops.map((o: { id: string }) => o.id)).toEqual(["x1"]);
  const other = await t.signIn("other@example.com");
  expect((await sync(`Session ${other}`, { cursor: 0, ops: [] })).body.ops).toEqual([]);
});
