// What the server says about itself (GET /api/server): what it can do right
// now, so the app shows only features that work; the oldest app version it
// accepts; and its release. Asked at start and again when the tab comes back
// (at most every few minutes); the last answer is kept for the next start.
// Until it is known, every feature counts as off (no buttons that then vanish).
//
// A newer release on the server than the one this app was built from means a
// deploy happened while the tab was open: the gentle reload banner says so.
// An app older than minClientVersion gets the same banner (writes are also
// refused with 426 until it reloads).

import { Effect, Option, Schema } from "effect";
import { ServerInfo } from "perennial-contract";
import { useSyncExternalStore } from "react";
import { APP_VERSION, RELEASE } from "../version";
import { reloadNeeded, request } from "./http";

/** What the server can do now. `ai`: Perennial AI (words from your own texts, new sentences). */
export type Features = ServerInfo["features"];

const KEY = "perennial-server";
const OFF: Features = { ai: false };
const Kept = Schema.fromJsonString(ServerInfo);

let features: Features = cached() ?? OFF;
const listeners = new Set<() => void>();
let fetched = false;

/** The last answer, kept from an earlier visit. Not there, or not readable (no storage, an old shape): null. */
function cached(): Features | null {
  try {
    return Option.getOrNull(Option.map(Schema.decodeUnknownOption(Kept)(localStorage.getItem(KEY)), (info) => info.features));
  } catch {
    // No storage (private mode): nothing was kept.
    return null;
  }
}

/** "1.10.0" ≥ "1.9.2", by numbers. */
export function versionAtLeast(v: string, min: string): boolean {
  const a = v.split(".").map(Number);
  const b = min.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

async function load() {
  // Offline, or an error answer: keep the last known one. An answer that breaks the contract rejects (a bug).
  const info = await Effect.runPromise(request(ServerInfo, "/api/server").pipe(Effect.catch(() => Effect.succeed(null))));
  if (!info) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(info));
  } catch {
    // Not kept for next time; fine.
  }
  features = info.features;
  for (const l of listeners) l();
  if (!versionAtLeast(APP_VERSION, info.minClientVersion) || newDeploy(info.release)) reloadNeeded.dispatchEvent(new Event("reload"));
}

/** A different, real release on the server than the one this app came from. */
export function newDeploy(serverRelease: string, built = RELEASE): boolean {
  return built !== "dev" && serverRelease !== "dev" && !!serverRelease && serverRelease !== built;
}

const RECHECK_MS = 5 * 60_000;
let lastAsked = 0;

/** Ask the server (main.tsx calls this at start; the hook too, if first), then again when the tab returns. */
export function loadServerInfo() {
  if (fetched) return;
  fetched = true;
  lastAsked = Date.now();
  void load();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || Date.now() - lastAsked < RECHECK_MS) return;
    lastAsked = Date.now();
    void load();
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  loadServerInfo();
  return () => listeners.delete(l);
}

/** The server's features (off until known). */
export function useFeatures(): Features {
  return useSyncExternalStore(subscribe, () => features);
}
