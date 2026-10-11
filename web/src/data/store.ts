// The learner's synced data. Each table is a TanStack DB collection fed by an
// Electric shape (through our auth proxy) and, where the browser allows it,
// kept in SQLite on the device so the app opens offline. Writes go through an
// offline queue: they apply instantly on the device, are stored in IndexedDB,
// and are sent to /api/write when there is a connection.
//
// A store belongs to one user. Signing in (which can change the user id) or
// out disposes it and makes a new one; queued writes carry no user id, so they
// are sent for whoever is signed in when they upload.

import { electricCollectionOptions } from "@tanstack/electric-db-collection";
import { NonRetriableError, startOfflineExecutor, type OfflineExecutor } from "@tanstack/offline-transactions";
import { createCollection, type PendingMutation } from "@tanstack/react-db";
import { APP_VERSION } from "../version";
import type { CourseRow, ReviewRow, UserSentenceRow, UserWordRow, WordStateRow } from "./rows";

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Ask the user to reload when the server needs a newer app. */
export const reloadNeeded = new EventTarget();

type Persistence = Awaited<ReturnType<typeof openPersistence>>;

async function openPersistence(userId: string) {
  // OPFS SQLite needs a secure context and a modern browser; without it the
  // app still works, it just loads from the network on each start.
  if (!("storage" in navigator) || typeof navigator.storage.getDirectory !== "function" || !window.isSecureContext) return null;
  try {
    const { createBrowserWASQLitePersistence, openBrowserWASQLiteOPFSDatabase, persistedCollectionOptions } = await import("@tanstack/browser-db-sqlite-persistence");
    const database = await openBrowserWASQLiteOPFSDatabase({ databaseName: `perennial-${userId}.sqlite` });
    return { persistence: createBrowserWASQLitePersistence({ database }), persistedCollectionOptions };
  } catch (e) {
    console.warn("[store] local persistence unavailable", e);
    return null;
  }
}

/** Bump when a synced table's shape changes: the device copy is dropped and synced again. */
const SCHEMA_VERSION = 1;

function makeCollection<T extends object>(table: string, getKey: (row: T) => string, persisted: Persistence) {
  const options = electricCollectionOptions<T & Record<string, unknown>>({
    id: table,
    getKey: getKey as (row: T & Record<string, unknown>) => string,
    shapeOptions: {
      url: `${location.origin}/api/shape`,
      params: { table },
      parser: { timestamptz: (v: string) => v },
      // Signed out, or signed in as someone else: this store is being replaced. Stop quietly.
      onError: (e) => {
        if ((e as { status?: number }).status === 401) return;
        console.warn(`[store] ${table} sync error`, e);
        return {};
      },
    },
  });
  if (!persisted) return createCollection(options);
  return createCollection(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    persisted.persistedCollectionOptions({ ...(options as any), persistence: persisted.persistence, schemaVersion: SCHEMA_VERSION, initialRender: { strategy: "network-first", networkTimeoutMs: 1500 } }) as any,
  ) as unknown as ReturnType<typeof createCollection<T & Record<string, unknown>>>;
}

export async function createStore(userId: string) {
  const persisted = await openPersistence(userId);
  const collections = {
    course: makeCollection<CourseRow>("course", (r) => r.lang, persisted),
    review: makeCollection<ReviewRow>("review", (r) => r.id, persisted),
    word_state: makeCollection<WordStateRow>("word_state", (r) => r.word_id, persisted),
    user_word: makeCollection<UserWordRow>("user_word", (r) => r.id, persisted),
    user_sentence: makeCollection<UserSentenceRow>("user_sentence", (r) => r.id, persisted),
  };
  type Table = keyof typeof collections;

  const executor: OfflineExecutor = startOfflineExecutor({
    collections,
    mutationFns: {
      write: async ({ transaction, idempotencyKey }) => {
        const mutations = transaction.mutations.map(toServer).filter((m): m is NonNullable<typeof m> => !!m);
        if (!mutations.length) return;
        const res = await fetch("/api/write", {
          method: "POST",
          headers: { "content-type": "application/json", "x-perennial-version": APP_VERSION, "idempotency-key": idempotencyKey },
          body: JSON.stringify({ mutations }),
        });
        if (res.status === 426) {
          reloadNeeded.dispatchEvent(new Event("reload"));
          throw new HttpError(426, "please reload");
        }
        // Invalid, or over a storage limit: retrying would never succeed.
        if (res.status === 422 || res.status === 413 || (res.status === 429 && (await res.clone().text()).includes('"quota"'))) throw new NonRetriableError(`rejected: ${await res.text()}`);
        if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status}`);
        const { txid } = (await res.json()) as { txid: number };
        // Keep the optimistic rows until Electric echoes the write back.
        const tables = new Set(transaction.mutations.map((m) => m.collection.id as Table));
        await Promise.all([...tables].map((t) => collections[t]?.utils.awaitTxId(txid, 15_000).catch(() => {})));
      },
    },
    // A session that expired offline, or an app that must reload first: keep
    // the queued writes and try again later instead of dropping them.
    shouldRetry: (err) => (err instanceof HttpError && (err.status === 401 || err.status === 426) ? true : undefined),
    onStorageFailure: (d) => console.warn("[store] offline queue storage:", d.code, d.message),
  });
  await executor.waitForInit();
  if (import.meta.env.DEV) (window as unknown as { __store: unknown }).__store = { userId, collections };

  /** Apply changes on the device now; send them to the server when possible. */
  function write(mutate: () => void) {
    const tx = executor.createOfflineTransaction({ mutationFnName: "write", autoCommit: false });
    tx.mutate(mutate);
    return tx.commit();
  }

  return {
    userId,
    collections,
    write,
    pendingWrites: () => executor.getPendingCount(),
    dispose() {
      executor.dispose();
      for (const c of Object.values(collections)) void c.cleanup();
    },
  };
}

export type Store = Awaited<ReturnType<typeof createStore>>;

/** One local change → the server's mutation format (see server/src/sync.ts). */
function toServer(m: PendingMutation) {
  const row = m.modified as Record<string, unknown>;
  const old = m.original as Record<string, unknown>;
  const strip = ({ user_id: _u, created_at: _c, received_at: _r, ...rest }: Record<string, unknown>) => rest;
  switch (m.collection.id) {
    case "review":
      return m.type === "delete" ? { type: "review.delete", id: old.id } : m.type === "insert" ? { type: "review.insert", row: strip(row) } : null;
    case "course":
      return m.type === "delete" ? null : { type: "course.upsert", row: m.type === "update" ? { lang: row.lang, ...(m.changes as object) } : strip(row) };
    case "word_state":
      return m.type === "delete" ? { type: "word_state.delete", word_id: old.word_id, updated_at: new Date().toISOString() } : { type: "word_state.upsert", row: strip(row) };
    case "user_word":
      return m.type === "delete" ? { type: "user_word.delete", id: old.id } : { type: "user_word.upsert", row: strip(row) };
    case "user_sentence":
      return m.type === "delete" ? { type: "user_sentence.delete", id: old.id } : m.type === "insert" ? { type: "user_sentence.insert", row: strip(row) } : null;
  }
  return null;
}
