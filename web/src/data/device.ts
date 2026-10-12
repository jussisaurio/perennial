// What a learner leaves on this device: their SQLite copy (OPFS) and their
// queue of writes not yet sent (IndexedDB). Both are per user. Signing out or
// deleting the account forgets them here.
//
// The app reloads right after a sign-out, and an open database cannot be
// deleted, so forgetting is two steps: clear the queue now (so nothing more
// uploads), and remember to delete the files on the next start, before any
// store opens. Deletion is best effort and tried again on each start.
//
// One exception: an anonymous learner who signs in with email keeps their
// queue (see adoptOnDevice).

export const outboxName = (userId: string) => `perennial-outbox-${userId}`;
export const databaseName = (userId: string) => `perennial-${userId}.sqlite`;

const FORGET_KEY = "perennial-forget";

function forgetList(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FORGET_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveForgetList(ids: string[]) {
  try {
    if (ids.length) localStorage.setItem(FORGET_KEY, JSON.stringify(ids));
    else localStorage.removeItem(FORGET_KEY);
  } catch {
    // No storage: nothing to remember; the files stay until the browser clears them.
  }
}

/** Open stores register how to empty their queue, so a sign-out can stop uploads at once. */
const openOutboxes = new Map<string, () => Promise<void>>();

export function registerOutbox(userId: string, clear: () => Promise<void>) {
  openOutboxes.set(userId, clear);
  return () => {
    if (openOutboxes.get(userId) === clear) openOutboxes.delete(userId);
  };
}

/** Mark this user's device data for deletion. Undo with `keepOnDevice` if the sign-out fails. */
export function forgetOnDevice(userId: string) {
  // Signed out before a move happened: nobody inherits those writes either.
  const list = adoptions();
  const orphans = list.filter((a) => a.to === userId).map((a) => a.from);
  saveAdoptions(list.filter((a) => a.from !== userId && a.to !== userId));
  saveForgetList([...new Set([...forgetList(), userId, ...orphans])]);
}

export function keepOnDevice(userId: string) {
  saveForgetList(forgetList().filter((id) => id !== userId));
}

/** Empty an open store's queue now (best effort). */
export async function clearOutboxNow(userId: string) {
  try {
    await openOutboxes.get(userId)?.();
  } catch (e) {
    console.warn("[device] could not clear the write queue", e);
  }
}

function deleteIndexedDB(name: string): Promise<boolean> {
  if (typeof indexedDB === "undefined") return Promise.resolve(true);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      // Open in another tab: it is deleted once that tab closes it; try again next start too.
      req.onblocked = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function deleteOPFSDatabase(name: string): Promise<boolean> {
  if (!("storage" in navigator) || typeof navigator.storage.getDirectory !== "function") return true;
  try {
    const root = await navigator.storage.getDirectory();
    let ok = true;
    // SQLite's journal files sit next to the database (see OPFSCoopSyncVFS).
    for (const suffix of ["", "-journal", "-wal"]) {
      await root.removeEntry(name + suffix).catch((e: unknown) => {
        if ((e as { name?: string }).name !== "NotFoundError") ok = false;
      });
    }
    return ok;
  } catch {
    return false;
  }
}

async function deleteAll(userId: string): Promise<boolean> {
  const [a, b, c] = await Promise.all([deleteIndexedDB(outboxName(userId)), deleteOPFSDatabase(databaseName(userId)), deleteLocalStorageOutbox(userId)]);
  return a && b && c;
}

async function deleteLocalStorageOutbox(userId: string): Promise<boolean> {
  try {
    const prefix = `${outboxName(userId)}:`;
    for (const k of Object.keys(localStorage)) if (k.startsWith(prefix)) localStorage.removeItem(k);
    return true;
  } catch {
    return true;
  }
}

// An anonymous learner who signs in keeps their progress (the server merges
// it into the account), so their unsent writes move to the account's queue.
const ADOPT_KEY = "perennial-adopt";
type Adoption = { from: string; to: string };

function adoptions(): Adoption[] {
  try {
    const v = JSON.parse(localStorage.getItem(ADOPT_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((a): a is Adoption => typeof a?.from === "string" && typeof a?.to === "string") : [];
  } catch {
    return [];
  }
}

function saveAdoptions(list: Adoption[]) {
  try {
    if (list.length) localStorage.setItem(ADOPT_KEY, JSON.stringify(list));
    else localStorage.removeItem(ADOPT_KEY);
  } catch {
    // No storage: the anonymous queue is not carried over.
  }
}

/** The anonymous user `from` became the account `to`: its queued writes are theirs. */
export function adoptOnDevice(from: string, to: string) {
  if (from === to) return;
  saveAdoptions([...adoptions().filter((a) => a.from !== from), { from, to }]);
}

/** Users whose queues `userId` takes over. */
export const adoptedBy = (userId: string) => adoptions().filter((a) => a.to === userId).map((a) => a.from);

/** Done moving `from`'s queue: forget the rest of what it left here. */
export function adopted(from: string) {
  saveAdoptions(adoptions().filter((a) => a.from !== from));
  forgetOnDevice(from);
}

let cleaning: Promise<void> | null = null;

/** Delete the files of users who signed out here. Runs once per start, before any store opens. */
export function cleanUpForgotten(): Promise<void> {
  cleaning ??= (async () => {
    const ids = forgetList();
    if (!ids.length) return;
    const left: string[] = [];
    for (const id of ids) if (!(await deleteAll(id))) left.push(id);
    // Someone may have been marked while this ran: keep those too.
    saveForgetList([...new Set([...left, ...forgetList().filter((id) => !ids.includes(id))])]);
  })().catch((e) => console.warn("[device] cleanup failed", e));
  return cleaning;
}
