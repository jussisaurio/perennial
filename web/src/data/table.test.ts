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
  const table = makeTable<Row>("review", (r) => r.id, () => rows, () => false);

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
