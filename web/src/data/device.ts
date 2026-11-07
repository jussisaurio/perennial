// What this device keeps: the course it shows (keepCourse), and the open
// store's sync, so a sign-out can stop it. Older versions also kept unsent
// writes here (IndexedDB, localStorage) and, before #188, a SQLite copy in
// OPFS: deleteOldOfflineData removes them.

/** The open store's sync for a user: signing out stops it before the server ends the session. */
const openSyncs = new Map<string, () => void>();

export function registerSync(userId: string, stop: () => void) {
  openSyncs.set(userId, stop);
  return () => {
    if (openSyncs.get(userId) === stop) openSyncs.delete(userId);
  };
}

/** Stop it; true if there was one to stop. */
export function stopSyncNow(userId: string): boolean {
  const stop = openSyncs.get(userId);
  stop?.();
  return !!stop;
}

/** Names the old write queues and the old offline copy used. */
const OLD_DATA = /^(perennial-outbox-|offline-transactions$|perennial-forget$|perennial-adopt$|perennial-pending-link$|perennial-[^/]+\.sqlite)/;

/**
 * Delete what older versions kept on this device (#810). A learner who signed
 * out on a shared computer expects their data gone from it. Nothing waits on
 * this: a database another tab holds open is deleted once that tab closes it.
 */
export async function deleteOldOfflineData() {
  try {
    for (const k of Object.keys(localStorage)) if (OLD_DATA.test(k)) localStorage.removeItem(k);
    for (const { name } of await indexedDB.databases()) if (name && OLD_DATA.test(name)) indexedDB.deleteDatabase(name);
    const root = await navigator.storage.getDirectory();
    for await (const name of root.keys()) if (OLD_DATA.test(name)) await root.removeEntry(name);
  } catch (e) {
    // A browser without one of these stores has nothing old in it; anything else is worth a look.
    console.warn("[device] could not delete old offline data", e);
  }
}

// The course this device shows: a per-device convenience, not synced.
const COURSE_KEY = "perennial-course";
export const keepCourse = (lang: string) => {
  try {
    localStorage.setItem(COURSE_KEY, lang);
  } catch {
    /* private mode: the first course shows */
  }
};
export const readCourse = () => {
  try {
    return localStorage.getItem(COURSE_KEY);
  } catch {
    return null;
  }
};
