// One learner table as a TanStack DB collection, filled from GET /api/rows.
// The rows go in a slice at a time, each its own task: thousands of reviews in
// one commit kept the main thread busy for ~120 ms at CPU 10× (#447).

import { isCancelledError } from "@tanstack/query-core";
import { createCollection, deepEquals, type ChangeMessageOrDeleteKeyMessage, type SyncConfig } from "@tanstack/react-db";
import type { LearnerRows } from "perennial-contract";
import { yieldToBrowser } from "../lib/yield";

/** Rows per commit: one commit of 100 rows is about 5 ms at CPU 10×. */
const ROWS_PER_SLICE = 100;

type Sync<T extends object> = Parameters<SyncConfig<T, string>["sync"]>[0];

/**
 * `read` gives every table's rows (the tables share one request); `toRow`
 * checks or changes a row first. `skip` says whether a read failed only
 * because it was stopped or the learner signed out: then nothing changes.
 */
export function makeTable<T extends object>(
  table: keyof LearnerRows,
  getKey: (row: T) => string,
  read: () => Promise<LearnerRows>,
  skip: (e: unknown) => boolean,
  toRow: (row: Record<string, unknown>) => Record<string, unknown> = (row) => row,
) {
  let synced: Sync<T> | undefined;
  /** The rows as last written to the synced state, to compare a new read against. */
  const server = new Map<string, T>();
  /** Per read under way: rows kept (below) since it started, which it may not have. */
  const reads = new Set<Set<string>>();
  /** A newer read, or the end of syncing, stops the one applying. */
  let generation = 0;

  /** Read the rows and make the collection hold exactly them, but for rows kept meanwhile. */
  async function load() {
    const gen = ++generation;
    const kept = new Set<string>();
    reads.add(kept);
    try {
      let all: LearnerRows;
      try {
        all = await read();
      } catch (e) {
        // A newer read replaces this one, or this store is being replaced (see `skip`).
        if (isCancelledError(e) || skip(e)) return;
        throw e;
      }
      const rows = all[table];
      const seen = new Set<string>();
      let applied: ReturnType<Sync<T>["commit"]> = true;
      const commit = (writes: ChangeMessageOrDeleteKeyMessage<T, string>[]) => {
        if (!writes.length) return;
        const s = synced!;
        s.begin();
        for (const w of writes) s.write(w);
        applied = s.commit();
      };
      const stale = async () => {
        await yieldToBrowser();
        return gen !== generation;
      };
      for (let i = 0; i < rows.length; i += ROWS_PER_SLICE) {
        // Each table its own tasks: they all get their rows at once.
        if (await stale()) return;
        const writes: ChangeMessageOrDeleteKeyMessage<T, string>[] = [];
        for (const raw of rows.slice(i, i + ROWS_PER_SLICE)) {
          const row = toRow(raw) as T;
          const key = getKey(row);
          seen.add(key);
          if (kept.has(key)) continue;
          const was = server.get(key);
          if (was && deepEquals(was, row)) continue;
          server.set(key, row);
          writes.push({ type: was ? "update" : "insert", value: row });
        }
        commit(writes);
      }
      const gone = [...server.keys()].filter((key) => !seen.has(key) && !kept.has(key));
      for (let i = 0; i < gone.length; i += ROWS_PER_SLICE) {
        if (await stale()) return;
        const keys = gone.slice(i, i + ROWS_PER_SLICE);
        for (const key of keys) server.delete(key);
        commit(keys.map((key) => ({ type: "delete", key })));
      }
      // Ready once every row is visible: a commit waits while a local write is being sent.
      if (applied !== true) await applied;
      if (gen === generation) synced!.markReady();
    } finally {
      reads.delete(kept);
    }
  }

  const collection = createCollection<T, string>({
    id: table,
    getKey,
    // Read at once, all tables together: the screens need them all.
    startSync: true,
    sync: {
      sync: (params) => {
        synced = params;
        server.clear();
        void load();
        // Stop a read under way. `synced` stays: a write the server confirms
        // after the store is disposed is kept into this ended run, and TanStack
        // DB ignores that (nothing shows these rows any more; the server has them).
        return () => void generation++;
      },
    },
  });

  return Object.assign(collection, {
    /** Read the rows again. */
    refetch: load,
    /**
     * Make rows the server has the collection's own: only the written rows,
     * straight to the synced state. A read under way may predate them, so it
     * leaves them as they are.
     */
    keep(change: { row: Partial<T> } | { deleted: string }) {
      if (!synced) throw new Error(`${table}: not syncing`);
      const key = "row" in change ? getKey(change.row as T) : change.deleted;
      for (const kept of reads) kept.add(key);
      if ("row" in change) server.set(key, { ...server.get(key), ...change.row } as T);
      else server.delete(key);
      synced.begin();
      // Whole rows. An update of a row the table lacks adds it (rows merge: rowUpdateMode "partial").
      synced.write("row" in change ? { type: "update", value: change.row as T } : { type: "delete", key });
      synced.commit();
    },
  });
}
