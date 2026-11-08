import { afterEach, expect, test } from "bun:test";
import { focusManager } from "@tanstack/query-core";
import type { LearnerRows } from "perennial-contract";
import { rowsReader } from "./rowsReader";

const rows: LearnerRows = { course: [], review: [], word_state: [], user_word: [], user_sentence: [] };

afterEach(() => focusManager.setFocused(undefined));

test("a read that failed while the tab was hidden is tried again when the tab is shown (#911)", async () => {
  let tries = 0;
  const reader = rowsReader(async () => {
    tries++;
    if (tries === 1) throw new Error("network");
    return rows;
  });
  focusManager.setFocused(false);
  const read = reader.read();
  // The first try fails; the second waits for the tab (TanStack's first retry is 1 s later).
  await new Promise((r) => setTimeout(r, 1300));
  expect(tries).toBe(1);
  focusManager.setFocused(true);
  const stuck = new Promise<"stuck">((r) => setTimeout(() => r("stuck"), 500));
  expect(await Promise.race([read, stuck])).toEqual(rows);
  reader.unmount();
});
