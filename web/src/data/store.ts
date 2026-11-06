// The learner's synced data. Each table is a TanStack DB query collection, held
// in memory and read from GET /api/rows: at start, and again when the tab comes
// back into view after a while. Writes go through a queue (TanStack DB's offline
// transactions): they apply instantly on the device, are stored in IndexedDB,
// and are sent to /api/write, with retries, until the server has them. Then the
// rows go into the collection as the server's own.
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
import { QueryClient } from "@tanstack/query-core";
import { queryCollectionOptions } from "@tanstack/query-db-collection";
import { IndexedDBAdapter, LocalStorageAdapter, startOfflineExecutor, type OfflineExecutor, type StorageAdapter } from "@tanstack/offline-transactions";
import { createCollection, type PendingMutation } from "@tanstack/react-db";
import { Effect } from "effect";
import { LearnerRows, type WriteResult } from "perennial-contract";
import { sessionUserId } from "./auth";
import { adopted, adoptedBy, cleanUpForgotten, keepOnDevice, outboxName, registerOutbox, registerSync, resolvePendingLink } from "./device";
import { ApiError, HttpError, request } from "./http";
import { reportBadAnswer } from "../observability";
import { syncedUserWord, type CourseRow, type ReviewRow, type UserSentenceRow, type UserWordRow, type WordStateRow } from "./rows";
import { OtherUser, sendQueued, shouldRetry } from "./send";
import { tabLock } from "./tabLock";

/**
 * Read the rows again when the tab comes back after this long hidden: a quick
 * look at another tab needs no new read, but the learner may have used another
 * device meanwhile.
 */
const REFETCH_AFTER_HIDDEN_MS = 60_000;

/** Signed out: this store is being replaced, so asking again cannot help. */
const signedOut = (e: unknown) => (e instanceof ApiError && e.body.error === "sign_in_required") || (e instanceof HttpError && e.status === 401);

/**
 * One table's collection, filled from `read` (one GET /api/rows for all of
 * them). `toRow` checks or changes a row first; the columns are the table's
 * own (rows.ts) and are not checked one by one.
 */
function makeCollection<T extends object>(
  table: keyof LearnerRows,
  getKey: (row: T) => string,
  read: () => Promise<LearnerRows>,
  queryClient: QueryClient,
  toRow: (row: Record<string, unknown>) => Record<string, unknown> = (row) => row,
) {
  const options = queryCollectionOptions({
    id: table,
    queryKey: [table],
    queryFn: async () => (await read())[table].map((row) => toRow(row) as T),
    queryClient,
    getKey,
    // Read at once, all tables together: the screens need them all.
    startSync: true,
    // Read again only when the store says so (refetchAll below), never on a timer or focus.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    // Keep trying (paused while offline, at most 30 s apart) until the rows come: the screens wait for them.
    retry: (_count, e) => !signedOut(e),
  });
  // The collection's own sync calls, for `keep` below.
  let synced: Parameters<typeof options.sync.sync>[0] | undefined;
  const collection = createCollection({
    ...options,
    sync: {
      ...options.sync,
      sync: (params) => {
        synced = params;
        return options.sync.sync(params);
      },
    },
  });
  /**
   * Make rows the server has the collection's own. utils.writeUpsert costs a
   * copy and a deep compare of the whole table (#521: 80–130 ms per answer for
   * the review table), so only the written rows go in, straight to the synced
   * state. A read under way may return older rows; then writeUpsert, which
   * guards against that.
   */
  const keep = (change: { row: Partial<T> } | { deleted: string }) => {
    if (queryClient.isFetching({ queryKey: [table] }) > 0)
      return "row" in change ? collection.utils.writeUpsert(change.row) : collection.utils.writeDelete(change.deleted);
    if (!synced) throw new Error(`${table}: not syncing`);
    synced.begin();
    // Whole rows, as writeUpsert takes them. An update of a row the table lacks adds it.
    synced.write("row" in change ? { type: "update", value: change.row as T } : { type: "delete", key: change.deleted });
    synced.commit();
  };
  return Object.assign(collection, { keep });
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

export async function createStore(userId: string, email: string | null) {
  // Queues of learners who signed out here go first; this learner is using theirs again.
  await cleanUpForgotten();
  keepOnDevice(userId);
  // An account's first start after a sign-in that this tab did not see finish
  // (#314): the anonymous learner's queue is the account's now. (Anonymous: no email.)
  resolvePendingLink(userId, email);
  // Stopped before a sign-out reaches the server (stopSyncNow): a read still under way
  // would otherwise get a 401 and mark its collection failed.
  const sync = new AbortController();
  const queryClient = new QueryClient();
  // The tables' reads at the same moment share one request.
  let reading: Promise<LearnerRows> | null = null;
  const read = () => {
    if (reading) return reading;
    const p = Effect.runPromise(request(LearnerRows, "/api/rows"), { signal: sync.signal }).finally(() => {
      if (reading === p) reading = null;
    });
    return (reading = p);
  };
  const collections = {
    course: makeCollection<CourseRow>("course", (r) => r.lang, read, queryClient),
    review: makeCollection<ReviewRow>("review", (r) => r.id, read, queryClient),
    word_state: makeCollection<WordStateRow>("word_state", (r) => r.word_id, read, queryClient),
    user_word: makeCollection<UserWordRow>("user_word", (r) => r.id, read, queryClient, (row) =>
      syncedUserWord(row, (type) => reportBadAnswer("/api/rows user_word.forms", `forms: ${type}`)),
    ),
    user_sentence: makeCollection<UserSentenceRow>("user_sentence", (r) => r.id, read, queryClient),
  };
  type Table = keyof typeof collections;
  const stopSync = () => {
    // Cancelled queries go back to how they were, with no error; then the request itself stops.
    void queryClient.cancelQueries();
    sync.abort();
  };
  /** Read every table again, in one new request: one already under way may have started before a change. */
  const refetchAll = () => {
    if (sync.signal.aborted) return Promise.resolve();
    reading = null;
    return Promise.all(Object.values(collections).map((c) => c.utils.refetch())).then(() => undefined);
  };
  let hiddenAt: number | null = null;
  const onVisibility = () => {
    if (document.visibilityState === "hidden") return void (hiddenAt = Date.now());
    if (hiddenAt !== null && Date.now() - hiddenAt > REFETCH_AFTER_HIDDEN_MS) void refetchAll();
    hiddenAt = null;
  };
  document.addEventListener("visibilitychange", onVisibility);

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
  let refused: Refused = { count: 0, clock: 0, gardenClock: 0, seen: 0 };
  const refusedListeners = new Set<() => void>();
  const setRefused = (r: Refused) => {
    refused = r;
    for (const l of refusedListeners) l();
  };
  // The server refuses answers, and garden changes (#351), dated over a day ahead of its clock
  // (server/src/sync.ts): the learner can fix that, so each is counted on its own.
  const noteRefused = (e: ApiError | HttpError) => {
    const code = e._tag === "ApiError" ? e.body.error : null;
    setRefused({ ...refused, count: refused.count + 1, clock: refused.clock + (code === "review_from_the_future" ? 1 : 0), gardenClock: refused.gardenClock + (code === "garden_from_the_future" ? 1 : 0) });
  };

  const disposers = new Set<() => void>();

  const storage = await outboxStorage(userId);
  if (storage) await adoptQueues(userId, storage);
  const executor: OfflineExecutor = startOfflineExecutor({
    collections,
    storage,
    leaderElection: tabLock(`perennial-writer-${userId}`),
    onLeadershipChange: setWriter,
    mutationFns: {
      // Traced (sampled, see observability.ts): the time to save a write.
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
              // The server has them: the rows become the collection's own, so they stay
              // when this transaction ends (no flicker until the next read).
              // An answer that broke the contract (null, reported) has no stored rows: the device's stay.
              yield* Effect.promise(() => confirm(transaction.mutations, result?.stored));
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

  /**
   * Put rows the server took into the collections. The server merges courses
   * and word states (the garden's bowl, the newer word state): of those, its
   * stored rows go in, not the device's.
   * A failure here is a bug, reported; the write itself is saved.
   */
  function confirm(mutations: readonly PendingMutation[], stored?: WriteResult["stored"]) {
    const merged = new Map<string, Record<string, unknown>>();
    for (const row of stored?.course ?? []) merged.set(`course:${String(row.lang)}`, row);
    for (const row of stored?.word_state ?? []) merged.set(`word_state:${String(row.word_id)}`, row);
    return Promise.all(
      mutations.map(async (m) => {
        const table = m.collection.id as Table;
        const { keep } = collections[table];
        const server = merged.get(`${table}:${String(m.key)}`);
        if (server) return keep({ row: server });
        return m.type === "delete" ? keep({ deleted: m.key as string }) : keep({ row: m.modified });
      }),
    ).then(
      () => undefined,
      (e: unknown) => void (console.error("[store] could not keep saved rows", e), Sentry.captureException(e)),
    );
  }
  const unregister = registerOutbox(userId, () => executor.clearOutbox());
  const unregisterSync = registerSync(userId, stopSync);
  if (import.meta.env.DEV) (window as unknown as { __store: unknown }).__store = { userId, collections, refetchAll };

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
    refetchAll,
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
    /** Runs `cb` when the store is disposed: for what follows the tables itself (data/learner.ts). */
    onDispose: (cb: () => void) => void disposers.add(cb),
    dispose() {
      // First: a collection is cleaned up only once nothing follows it.
      for (const d of disposers) d();
      unregister();
      unregisterSync();
      document.removeEventListener("visibilitychange", onVisibility);
      stopSync();
      writerListeners.clear();
      refusedListeners.clear();
      executor.dispose();
      for (const c of Object.values(collections)) cleanUpWhenUnused(c);
    },
  };
}

export type Store = Awaited<ReturnType<typeof createStore>>;

/** Writes the server refused for good: all of them, answers and garden changes refused for a wrong device clock, and how many the learner was told of. */
export interface Refused {
  count: number;
  clock: number;
  gardenClock: number;
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
