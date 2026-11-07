// The learner's synced data. Each table is a TanStack DB query collection, held
// in memory and read from GET /api/rows (at start, from GET /api/boot), and
// again when the tab comes back into view after a while. Writes apply at once
// on the device and are sent to /api/write, one after another, tried again
// until the server has them. Then the rows go into the collection as the
// server's own.
//
// Unsent writes live only in this tab's memory. When the page goes away
// (pagehide), what is left goes in one last request; if that fails too, it is
// lost. Every tab writes: the server merges writes from tabs as it does from
// devices (server/src/sync.ts).
//
// A store belongs to one user: a write is never sent while another user is
// signed in. Signing in or out disposes the store and makes a new one.

import { QueryClient } from "@tanstack/query-core";
import { createCollection, createTransaction, type PendingMutation } from "@tanstack/react-db";
import { Effect } from "effect";
import { LearnerRows, type WriteResult } from "perennial-contract";
import { sessionUserId } from "./auth";
import { boot } from "./boot";
import { registerSync } from "./device";
import { ApiError, HttpError, request, sendWrite } from "./http";
import { reportBadAnswer, reportError } from "../observability";
import { Learners } from "./learner";
import { makeTable } from "./table";
import { yieldToBrowser } from "../lib/yield";
import { syncedUserWord, type CourseRow, type ReviewRow, type UserSentenceRow, type UserWordRow, type WordStateRow } from "./rows";
import { sendUntilStored } from "./send";

/**
 * Read the rows again when the tab comes back after this long hidden: a quick
 * look at another tab needs no new read, but the learner may have used another
 * device meanwhile.
 */
const REFETCH_AFTER_HIDDEN_MS = 60_000;

/** A write unsent this long is late: the learner is told it is not saved yet. A normal send takes well under a second. */
const LATE_MS = 10_000;

/** Signed out: this store is being replaced, so asking again cannot help. */
const signedOut = (e: unknown) => (e instanceof ApiError && e.body.error === "sign_in_required") || (e instanceof HttpError && e.status === 401);

export async function createStore(userId: string) {
  // Stopped before a sign-out reaches the server (stopSyncNow): a read still under way
  // would otherwise get a 401 and mark its collection failed.
  const sync = new AbortController();
  const queryClient = new QueryClient();
  // Each table's first read is the rows that came with /api/boot, if they are this
  // user's (#602); refetchAll reads the server again. null: not this user's (an
  // anonymous learner who started just now), or boot failed: read /api/rows.
  let fromBoot: Promise<LearnerRows | null> | null = boot().then(
    (b) => (b.user?.id === userId ? b.rows : null),
    () => null,
  );
  // The tables' reads at the same moment share one request.
  const read = () =>
    queryClient.fetchQuery({
      queryKey: ["rows"],
      queryFn: async () => (fromBoot && (await fromBoot)) ?? Effect.runPromise(request(LearnerRows, "/api/rows"), { signal: sync.signal }),
      // A new request each time, unless one is under way (refetchAll cancels that one first).
      staleTime: 0,
      // Nothing kept once read: a cancelled read then fails (CancelledError), where it
      // would return the old response, and the full response is not held in memory.
      gcTime: 0,
      // Keep trying (paused while offline, at most 30 s apart) until the rows come: the screens wait for them.
      retry: (_count, e) => !signedOut(e),
    });
  // Each table in its own task, and the learners after them: making a table
  // starts its read, and all of it in one task was ~35 ms at CPU 10× (#569).
  // The reads still share one request: scheduler.yield resumes ahead of the
  // response. (Where it falls back to setTimeout, a late table may read again.)
  const table = async <T>(make: () => T) => {
    await yieldToBrowser();
    return make();
  };
  const collections = {
    course: await table(() => makeTable<CourseRow>("course", (r) => r.lang, read, sync.signal, signedOut)),
    review: await table(() => makeTable<ReviewRow>("review", (r) => r.id, read, sync.signal, signedOut)),
    word_state: await table(() => makeTable<WordStateRow>("word_state", (r) => r.word_id, read, sync.signal, signedOut)),
    user_word: await table(() =>
      makeTable<UserWordRow>("user_word", (r) => r.id, read, sync.signal, signedOut, (row) =>
        syncedUserWord(row, (type) => reportBadAnswer("/api/rows user_word.forms", `forms: ${type}`)),
      ),
    ),
    user_sentence: await table(() => makeTable<UserSentenceRow>("user_sentence", (r) => r.id, read, sync.signal, signedOut)),
  };
  type Table = keyof typeof collections;
  const disposers = new Set<() => void>();
  const onDispose = (cb: () => void) => void disposers.add(cb);
  // Now, while the first read is under way: see Learners.
  await yieldToBrowser();
  const learners = new Learners({ collections, onDispose });
  const stopSync = () => {
    // The read under way ends; aborting `sync` stops the tables applying it (makeTable) and the request itself.
    void queryClient.cancelQueries();
    sync.abort();
  };
  /** Read every table again, in one new request: one already under way may have started before a change. */
  const refetchAll = async () => {
    if (sync.signal.aborted) return;
    fromBoot = null;
    // A read under way would be joined (TanStack Query), and may predate the
    // change (#529: a course written while the first read ran never showed). Cancel it.
    await queryClient.cancelQueries();
    await Promise.all(Object.values(collections).map((c) => c.refetch()));
  };
  // Ends the wait between tries of a write at once: back online, or the tab is shown again.
  let wakeUp = () => {};
  let woken = new Promise<void>((r) => (wakeUp = r));
  const wake = () => {
    wakeUp();
    woken = new Promise<void>((r) => (wakeUp = r));
  };
  window.addEventListener("online", wake);
  let hiddenAt: number | null = null;
  const onVisibility = () => {
    if (document.visibilityState === "hidden") return void (hiddenAt = Date.now());
    wake();
    if (hiddenAt !== null && Date.now() - hiddenAt > REFETCH_AFTER_HIDDEN_MS) void refetchAll();
    hiddenAt = null;
  };
  document.addEventListener("visibilitychange", onVisibility);

  const otherUser = () => {
    const current = sessionUserId();
    return !!current && current !== userId;
  };
  // Writes the server does not have yet, by idempotency key, in the order made.
  const unsent = new Map<string, readonly unknown[]>();
  let unsentNow: Unsent = { count: 0, late: 0 };
  const unsentListeners = new Set<() => void>();
  const setUnsent = (u: Unsent) => {
    unsentNow = u;
    for (const l of unsentListeners) l();
  };
  // The page is going away: what is left goes in one request that outlives it.
  // Nothing can try again after this, so if it fails those writes are lost.
  const onPageHide = () => {
    if (!unsent.size || otherUser()) return;
    // A new key: this request joins several writes. Sent again after it (the page
    // came back from the back/forward cache), each still applies once more harmlessly: the server's merges are idempotent.
    Effect.runFork(sendWrite([...unsent.values()].flat(), crypto.randomUUID(), true).pipe(Effect.ignore));
  };
  window.addEventListener("pagehide", onPageHide);

  // Writes the server refused for good. They are rolled back on this device, so
  // the learner must be told (#253): "saved" would be untrue.
  let refused: Refused = { count: 0, clock: 0, seen: 0 };
  const refusedListeners = new Set<() => void>();
  const setRefused = (r: Refused) => {
    refused = r;
    for (const l of refusedListeners) l();
  };
  // The server refuses answers dated over a day ahead of its clock (server/src/sync.ts):
  // the learner can fix that, so they are counted on their own.
  const noteRefused = (e: ApiError | HttpError) => {
    const code = e._tag === "ApiError" ? e.body.error : null;
    setRefused({ ...refused, count: refused.count + 1, clock: refused.clock + (code === "review_from_the_future" ? 1 : 0) });
  };

  // Stops the writes still being sent when the store is disposed (a sign-out or a new user).
  const sending = new AbortController();
  // Sent one after another, in the order made: an undo must not reach the server before its answer.
  let lastSend: Promise<unknown> = Promise.resolve();
  /** Send one write's changes until the server has them. `at`: when they were made. */
  function send(changes: readonly PendingMutation[], at: string) {
    const mutations = changes.map((m) => toServer(m, at)).filter((m): m is NonNullable<typeof m> => !!m);
    if (!mutations.length) return Promise.resolve();
    // One key for every try: the server applies a write once.
    const key = crypto.randomUUID();
    unsent.set(key, mutations);
    setUnsent({ ...unsentNow, count: unsentNow.count + 1 });
    let late = false;
    const lateTimer = setTimeout(() => {
      late = true;
      setUnsent({ ...unsentNow, late: unsentNow.late + 1 });
    }, LATE_MS);
    const run = lastSend
      .then(() =>
        Effect.runPromise(
          Effect.gen(function* () {
            const result = yield* sendUntilStored(mutations, key, { otherUser, wake: () => woken, onRefused: noteRefused });
            // The server has them: the rows become the collection's own, so they stay
            // when this transaction ends (no flicker until the next read).
            // An answer that broke the contract (null, reported) has no stored rows: the device's stay.
            yield* Effect.promise(() => confirm(changes, result?.stored));
          }),
          { signal: sending.signal },
        ),
      )
      .finally(() => {
        clearTimeout(lateTimer);
        unsent.delete(key);
        setUnsent({ count: unsentNow.count - 1, late: unsentNow.late - (late ? 1 : 0) });
      });
    // The next write waits for this one to end, however it ends.
    lastSend = run.catch(() => undefined);
    return run;
  }

  /**
   * Put rows the server took into the collections. The server merges courses
   * and word states (the door that only opens, the newer word state): of those, its
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
      (e: unknown) => void (console.error("[store] could not keep saved rows", e), reportError(e)),
    );
  }
  const unregisterSync = registerSync(userId, stopSync);
  if (import.meta.env.DEV) (window as unknown as { __store: unknown }).__store = { userId, collections, refetchAll };

  /**
   * Apply changes on the device now; send them to the server. Resolves once the
   * server has them; a refusal rejects, and the changes roll back.
   */
  async function write(mutate: () => void) {
    // Stamped when the change is made, not when it uploads: a late change must not win over a newer one.
    const at = new Date().toISOString();
    const tx = createTransaction({ autoCommit: false, mutationFn: ({ transaction }) => send(transaction.mutations, at) });
    tx.mutate(mutate);
    await tx.commit();
  }

  return {
    userId,
    collections,
    write,
    refetchAll,
    /** Writes the server does not have yet. For useSyncExternalStore. */
    unsent: () => unsentNow,
    onUnsent: (cb: () => void) => {
      unsentListeners.add(cb);
      return () => void unsentListeners.delete(cb);
    },
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
    /** The learners of every language, kept live (data/learner.ts). */
    learners,
    /** Runs `cb` when the store is disposed: for what follows the tables itself (data/learner.ts). */
    onDispose,
    dispose() {
      // First: a collection is cleaned up only once nothing follows it.
      for (const d of disposers) d();
      unregisterSync();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", wake);
      window.removeEventListener("pagehide", onPageHide);
      stopSync();
      sending.abort();
      unsentListeners.clear();
      refusedListeners.clear();
      for (const c of Object.values(collections)) cleanUpWhenUnused(c);
    },
  };
}

export type Store = Awaited<ReturnType<typeof createStore>>;

/** Writes the server does not have yet, and how many of them are late (LATE_MS). */
export interface Unsent {
  count: number;
  late: number;
}

/** Writes the server refused for good: all of them, answers refused for a wrong device clock, and how many the learner was told of. */
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
