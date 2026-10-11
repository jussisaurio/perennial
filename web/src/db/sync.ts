// Op-log sync. Push unsent ops, pull everything after our cursor, repeat until
// caught up. Reviews are append-only and content is per-field LWW, so there is
// nothing to resolve by hand and never a "full sync".

import { getSession, onAccountChange } from "../hosted/api";
import { applyRemote, db, getMeta, recompute, recomputeCourse, setLocalChangeListener, setMeta, type Op } from "./db";

export interface SyncConfig {
  url: string; // e.g. https://perennial.example.com
  key: string; // shared secret identifying this learner's data
}

export type SyncStatus = { state: "off" } | { state: "idle"; at: number } | { state: "syncing" } | { state: "error"; message: string };

let status: SyncStatus = { state: "off" };
const listeners = new Set<(s: SyncStatus) => void>();
const setStatus = (s: SyncStatus) => {
  status = s;
  listeners.forEach((fn) => fn(s));
};
export const getStatus = () => status;
export const onStatus = (fn: (s: SyncStatus) => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

export const getSyncConfig = () => getMeta<SyncConfig | null>("sync", null);

/**
 * Moving to another sync space (a new code, or signing in to an account) means
 * everything local must be sent there too: the server ignores duplicates.
 */
export async function resetSyncState(): Promise<void> {
  await db.ops.toCollection().modify({ sent: 0 });
  await setMeta("cursor", 0);
}

export async function setSyncConfig(cfg: SyncConfig | null): Promise<void> {
  await setMeta("sync", cfg);
  await resetSyncState();
  if (cfg || (await getSession())) void sync();
  else setStatus({ state: "off" });
}

/** Signed in: sync under the account. Otherwise use the sync code, if any. */
async function target(): Promise<{ url: string; auth: string } | null> {
  const session = await getSession();
  if (session) return { url: location.origin, auth: `Session ${session.token}` };
  const cfg = await getSyncConfig();
  return cfg ? { url: cfg.url, auth: `Bearer ${cfg.key}` } : null;
}

/** Erase everything this sync code stored on the server, then stop syncing. */
export async function deleteSyncedData(): Promise<number> {
  const cfg = await getSyncConfig();
  if (!cfg) return 0;
  const res = await fetch(`${cfg.url.replace(/\/$/, "")}/api/sync/delete`, { method: "POST", headers: { authorization: `Bearer ${cfg.key}` } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const { removed } = (await res.json()) as { removed: number };
  await setSyncConfig(null);
  return removed;
}

export function newSyncKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
  return chars.match(/.{5}/g)!.join("-");
}

const BATCH = 500;
let running: Promise<void> | null = null;

export function sync(): Promise<void> {
  running ??= run().finally(() => (running = null));
  return running;
}

async function run(): Promise<void> {
  const to = await target();
  if (!to) return setStatus({ state: "off" });
  setStatus({ state: "syncing" });
  try {
    for (;;) {
      const unsent = await db.ops.where("sent").equals(0).limit(BATCH).toArray();
      const cursor = await getMeta<number>("cursor", 0);
      const res = await fetch(`${to.url.replace(/\/$/, "")}/sync`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: to.auth },
        body: JSON.stringify({ cursor, ops: unsent.map(({ sent: _, ...op }) => op) }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const body = (await res.json()) as { ops: Omit<Op, "sent">[]; cursor: number; more: boolean };
      await db.ops.bulkUpdate(unsent.map((o) => ({ key: o.id, changes: { sent: 1 as const } })));
      const touched = await applyRemote(body.ops);
      for (const id of touched.lexemes) await recompute(id);
      for (const id of touched.courses) await recomputeCourse(id);
      await setMeta("cursor", body.cursor);
      const stillUnsent = await db.ops.where("sent").equals(0).count();
      if (!body.more && stillUnsent === 0) break;
    }
    setStatus({ state: "idle", at: Date.now() });
  } catch (e) {
    setStatus({ state: "error", message: e instanceof Error ? e.message : String(e) });
  }
}

/** Sync shortly after local edits, periodically, and when the app regains focus or network. */
export function startAutoSync(): void {
  // Debounce local edits, but never hold changes back for more than 5s.
  let timer: ReturnType<typeof setTimeout> | undefined;
  let firstPending = 0;
  setLocalChangeListener(() => {
    clearTimeout(timer);
    const now = Date.now();
    firstPending ||= now;
    const wait = Math.max(0, Math.min(1500, firstPending + 5000 - now));
    timer = setTimeout(() => {
      firstPending = 0;
      void sync();
    }, wait);
  });
  setInterval(() => void sync(), 60_000);
  // A newly linked device has nothing yet: check often until its courses arrive.
  setInterval(() => {
    void (async () => {
      if ((await target()) && (await db.courses.count()) === 0) void sync();
    })();
  }, 3000);
  // Signing in or out changes the sync space.
  let signedIn: boolean | null = null;
  onAccountChange(() => {
    void getSession().then(async (s) => {
      if (signedIn !== null && signedIn === !!s) return;
      signedIn = !!s;
      await resetSyncState();
      void sync();
    });
  });
  void getSession().then((s) => (signedIn = !!s));
  window.addEventListener("online", () => void sync());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void sync();
  });
  void sync();
}
