import { expect, test } from "bun:test";
import type { LearnerRows } from "perennial-contract";
import { makeTable } from "./table";

interface Row {
  id: string;
  n: number;
}

const response = (review: Row[]): LearnerRows => ({ course: [], review: review.map((r) => ({ ...r })), word_state: [], user_word: [], user_sentence: [] });
// Without the virtual props ($synced and so on) TanStack DB adds.
const sorted = (rows: Row[]) => rows.map(({ id, n }) => ({ id, n })).sort((a, b) => a.id.localeCompare(b.id));

test("the table holds exactly the server's rows, and rows kept during a read stay", async () => {
  // More rows than one slice.
  const first = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, n: i }));
  let answer: (rows: LearnerRows) => void = () => {};
  let rows = new Promise<LearnerRows>((r) => (answer = r));
  const table = makeTable<Row>("review", (r) => r.id, () => rows, new AbortController().signal, () => false);

  // The server took these while the read was under way, which predates them.
  table.keep({ row: { id: "r5", n: -5 } });
  table.keep({ row: { id: "new", n: 1 } });
  table.keep({ deleted: "r7" });
  answer(response(first));
  await new Promise<void>((r) => table.onFirstReady(r));
  const kept = first.filter((r) => r.id !== "r7").map((r) => (r.id === "r5" ? { id: "r5", n: -5 } : r));
  expect(sorted(table.toArray)).toEqual(sorted([...kept, { id: "new", n: 1 }]));

  // A later read: one row changed, one gone, one added.
  const second = [...first.slice(1, 500), { id: "r500", n: 0 }, ...first.slice(501), { id: "x", n: 2 }];
  rows = Promise.resolve(response(second));
  await table.refetch();
  expect(sorted(table.toArray)).toEqual(sorted(second));
});

/** A read the test answers when it chooses. */
function pending() {
  let answer: (rows: LearnerRows) => void = () => {};
  const rows = new Promise<LearnerRows>((r) => (answer = r));
  return { rows, answer };
}

test("an older read writes nothing once a newer one has started", async () => {
  const older = pending();
  const newer = pending();
  let next = older.rows;
  const table = makeTable<Row>("review", (r) => r.id, () => next, new AbortController().signal, () => false);
  next = newer.rows;
  const loading = table.refetch();
  older.answer(response([{ id: "old", n: 1 }]));
  // Time for the older read to apply, if it could.
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  expect(table.toArray).toEqual([]);
  newer.answer(response([{ id: "new", n: 2 }]));
  await loading;
  expect(sorted(table.toArray)).toEqual([{ id: "new", n: 2 }]);
});

test("a read that ends after syncing stops (sign-out, dispose) changes nothing", async () => {
  const stop = new AbortController();
  let next = Promise.resolve(response([{ id: "a", n: 1 }]));
  const table = makeTable<Row>("review", (r) => r.id, () => next, stop.signal, () => false);
  await new Promise<void>((r) => table.onFirstReady(r));
  const late = pending();
  next = late.rows;
  const loading = table.refetch();
  // The server confirmed a write meanwhile; the read under way predates it.
  table.keep({ row: { id: "b", n: 2 } });
  stop.abort();
  // TanStack Query answers a cancelled read with the response it holds: an old one.
  late.answer(response([]));
  await loading;
  expect(sorted(table.toArray)).toEqual([
    { id: "a", n: 1 },
    { id: "b", n: 2 },
  ]);
});
