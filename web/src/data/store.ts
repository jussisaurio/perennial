// The learner's synced data. Each table is a TanStack DB collection fed by an
// Electric shape (through our auth proxy), held in memory. Writes go through a
// queue (TanStack DB's offline transactions): they apply instantly on the
// device, are stored in IndexedDB, and are sent to /api/write, with retries,
// until the server has them.
//
// A store belongs to one user, and so does its queue (see device.ts): a write
// queued by one learner is never sent while another is signed in, except that
// an anonymous learner's queue moves to the account they sign in to. Signing
// in or out disposes the store and makes a new one.
//
// One tab writes: the queue is shared by the user's tabs, so only the tab
// holding the user's Web Lock may write. Other tabs ask the learner to use
// that one (see `writer` below and App).

import * as Sentry from "@sentry/react";
import { electricCollectionOptions } from "@tanstack/electric-db-collection";
import { IndexedDBAdapter, LocalStorageAdapter, startOfflineExecutor, type OfflineExecutor, type StorageAdapter } from "@tanstack/offline-transactions";
import { createCollection, type PendingMutation } from "@tanstack/react-db";
import { Effect, Exit } from "effect";
import { sessionUserId } from "./auth";
import { adopted, adoptedBy, cleanUpForgotten, keepOnDevice, outboxName, registerOutbox, registerSync, resolvePendingLink } from "./device";
import type { ApiError, HttpError } from "./http";
import type { CourseRow, ReviewRow, UserSentenceRow, UserWordRow, WordStateRow } from "./rows";
import { OtherUser, sendQueued, shouldRetry } from "./send";
import { tabLock } from "./tabLock";

function makeCollection<T extends object>(table: string, getKey: (row: T) => string, sync: AbortSignal) {
  const options = electricCollectionOptions<T & Record<string, unknown>>({
    id: table,
    getKey: getKey as (row: T & Record<string, unknown>) => string,
    shapeOptions: {
      url: `${location.origin}/api/shape`,
      params: { table },
      signal: sync,
      // The abort reaches the stream, but not a prefetch it already chained: refuse new requests too.
      fetchClient: (input, init) => (sync.aborted ? Promise.reject(new DOMException("sync stopped", "AbortError")) : fetch(input, init)),
      parser: { timestamptz: (v: string) => v },
      // Signed out, or signed in as someone else: this store is being replaced. Stop quietly.
      onError: (e) => {
        if ((e as { status?: number }).status === 401) return;
        console.warn(`[store] ${table} sync error`, e);
        return {};
      },
    },
  });
  return createCollection(options);
}

/** This user's queue of unsent writes: their own IndexedDB database (or localStorage keys). */
async function outboxStorage(userId: string): Promise<StorageAdapter | undefined> {
  if ((await IndexedDBAdapter.probe()).available) return new IndexedDBAdapter(outboxName(userId));
  if (LocalStorageAdapter.probe().available) return new LocalStorageAdapter(`${outboxName(userId)}:`);
  // No storage at all: the executor finds none either, and writes go straight to the server.
  return undefined;
}

/** An anonymous learner who signed in: move their unsent writes into the account's queue. */
async function adoptQueues(userId: string, target: StorageAdapter) {
  for (const from of adoptedBy(userId)) {
    try {
      const source = await outboxStorage(from);
      if (source) {
        for (const key of await source.keys()) {
          const value = await source.get(key);
          if (value !== null) await target.set(key, value);
        }
        await source.clear();
      }
      adopted(from);
    } catch (e) {
      // Left in place; tried again on the next start.
      console.warn("[store] could not move queued writes", e);
    }
  }
}

export async function createStore(userId: string, anonymous: boolean) {
  // Queues of learners who signed out here go first; this learner is using theirs again.
  await cleanUpForgotten();
  keepOnDevice(userId);
  // An account's first start after a sign-in that this tab did not see finish
  // (#314): the anonymous learner's queue is the account's now.
  if (!anonymous) resolvePendingLink(userId);
  // Stopped before a sign-out reaches the server (stopSyncNow): a stream still loading
  // would otherwise get a 401 and mark its collection failed.
  const sync = new AbortController();
  const collections = {
    course: makeCollection<CourseRow>("course", (r) => r.lang, sync.signal),
    review: makeCollection<ReviewRow>("review", (r) => r.id, sync.signal),
    word_state: makeCollection<WordStateRow>("word_state", (r) => r.word_id, sync.signal),
    user_word: makeCollection<UserWordRow>("user_word", (r) => r.id, sync.signal),
    user_sentence: makeCollection<UserSentenceRow>("user_sentence", (r) => r.id, sync.signal),
  };
  type Table = keyof typeof collections;

  // Whether this tab may write. Without a queue (no storage) every tab sends directly.
  let writer = true;
  const writerListeners = new Set<() => void>();
  const setWriter = (v: boolean) => {
    if (writer === v) return;
    writer = v;
    for (const l of writerListeners) l();
  };

  // Writes the server refused for good. They are rolled back on this device, so
  // the learner must be told (#253): "saved" would be untrue.
  let refused: Refused = { count: 0, clock: 0, seen: 0 };
  const refusedListeners = new Set<() => void>();
  const setRefused = (r: Refused) => {
    refused = r;
    for (const l of refusedListeners) l();
  };
  // The server refuses answers dated over a day ahead of its clock (server/src/sync.ts): the
  // learner can fix that one, so it is counted on its own.
  const noteRefused = (e: ApiError | HttpError) =>
    setRefused({ ...refused, count: refused.count + 1, clock: refused.clock + (e._tag === "ApiError" && e.body.error === "review_from_the_future" ? 1 : 0) });

  const storage = await outboxStorage(userId);
  if (storage) await adoptQueues(userId, storage);
  const executor: OfflineExecutor = startOfflineExecutor({
    collections,
    storage,
    leaderElection: tabLock(`perennial-writer-${userId}`),
    onLeadershipChange: setWriter,
    mutationFns: {
      // Traced (sampled, see observability.ts): the time from sending a write
      // to seeing it come back through sync is the latency learners feel.
      write: ({ transaction, idempotencyKey }) =>
        Sentry.startSpan({ name: "sync write", op: "sync.write" }, (span) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const at = typeof transaction.metadata?.at === "string" ? transaction.metadata.at : undefined;
              const mutations = transaction.mutations.map((m) => toServer(m, at)).filter((m): m is NonNullable<typeof m> => !!m);
              if (!mutations.length) return;
              const current = sessionUserId();
              if (current && current !== userId) return yield* new OtherUser();
              span.setAttribute("mutations", mutations.length);
              const result = yield* sendQueued(mutations, idempotencyKey, noteRefused);
              // Nothing changed (say, a repeat of an earlier write), or no answer to read: no echo to wait for.
              if (!result?.changed) return;
              // Keep the optimistic rows until Electric echoes the write back.
              const tables = new Set(transaction.mutations.map((m) => m.collection.id as Table));
              const echoed = yield* Effect.forEach(
                tables,
                // After 15 s without the echo the rows stay as they are; the trace says so.
                (t) => Effect.tryPromise(() => collections[t].utils.awaitTxId(result.txid, 15_000)).pipe(Effect.exit, Effect.map(Exit.isSuccess)),
                { concurrency: "unbounded" },
              );
              span.setAttribute("echoed", echoed.every(Boolean));
            }),
          ),
        ),
    },
    // A session that expired offline, or an app that must reload first: keep
    // the queued writes (they are this user's) and try again later.
    shouldRetry,
    onStorageFailure: (d) => console.warn("[store] offline queue storage:", d.code, d.message),
  });
  await executor.waitForInit();
  const unregister = registerOutbox(userId, () => executor.clearOutbox());
  const unregisterSync = registerSync(userId, () => sync.abort());
  if (import.meta.env.DEV) (window as unknown as { __store: unknown }).__store = { userId, collections };

  /** Apply changes on the device now; send them to the server when possible. */
  function write(mutate: () => void) {
    if (!writer) return Promise.reject(new Error("Perennial is open in another tab"));
    // Stamped when the change is made, not when it uploads: an old offline change must not win over a newer one.
    const tx = executor.createOfflineTransaction({ mutationFnName: "write", autoCommit: false, metadata: { at: new Date().toISOString() } });
    tx.mutate(mutate);
    return tx.commit();
  }

  return {
    userId,
    collections,
    write,
    /** Whether this tab may write (see tabLock). For useSyncExternalStore. */
    isWriter: () => writer,
    onWriterChange: (cb: () => void) => {
      writerListeners.add(cb);
      return () => void writerListeners.delete(cb);
    },
    pendingWrites: () => executor.getPendingCount(),
    /** Writes the server refused since this store started. For useSyncExternalStore. */
    refused: () => refused,
    /** The learner has been told of every refusal so far. */
    seeRefused: () => {
      if (refused.seen !== refused.count) setRefused({ ...refused, seen: refused.count });
    },
    onRefused: (cb: () => void) => {
      refusedListeners.add(cb);
      return () => void refusedListeners.delete(cb);
    },
    dispose() {
      unregister();
      unregisterSync();
      writerListeners.clear();
      refusedListeners.clear();
      executor.dispose();
      for (const c of Object.values(collections)) cleanUpWhenUnused(c);
    },
  };
}

export type Store = Awaited<ReturnType<typeof createStore>>;

/** Writes the server refused for good: all of them, those refused for a wrong device clock, and how many the learner was told of. */
export interface Refused {
  count: number;
  clock: number;
  seen: number;
}

type Collection = Pick<ReturnType<typeof createCollection>, "subscriberCount" | "on" | "cleanup">;

/**
 * Clean up a collection once no live query reads it. The screens' live queries
 * outlive them by a moment (TanStack collects them on its own timer); a source
 * cleaned up under one logs "TanStack DB error 152".
 */
function cleanUpWhenUnused(c: Collection) {
  if (c.subscriberCount === 0) return void c.cleanup();
  const off = c.on("subscribers:change", (e) => {
    if (e.subscriberCount > 0) return;
    off();
    void c.cleanup();
  });
}

/** One local change → the server's mutation format (see server/src/sync.ts). `at`: when it was made. */
function toServer(m: PendingMutation, at?: string) {
  const row = m.modified as Record<string, unknown>;
  const old = m.original as Record<string, unknown>;
  const strip = ({ user_id: _u, created_at: _c, received_at: _r, ...rest }: Record<string, unknown>) => rest;
  switch (m.collection.id) {
    case "review":
      return m.type === "delete" ? { type: "review.delete", id: old.id } : m.type === "insert" ? { type: "review.insert", row: strip(row) } : null;
    case "course":
      return m.type === "delete" ? null : { type: "course.upsert", row: m.type === "update" ? { lang: row.lang, ...(m.changes as object) } : strip(row) };
    case "word_state":
      return m.type === "delete" ? { type: "word_state.delete", word_id: old.word_id, updated_at: at ?? new Date().toISOString() } : { type: "word_state.upsert", row: strip(row) };
    case "user_word":
      return m.type === "delete" ? { type: "user_word.delete", id: old.id } : { type: "user_word.upsert", row: strip(row) };
    case "user_sentence":
      return m.type === "delete" ? { type: "user_sentence.delete", id: old.id } : m.type === "insert" ? { type: "user_sentence.insert", row: strip(row) } : null;
  }
  return null;
}
