// What the server says about itself (GET /api/server): what it can do right
// now, so the app shows only features that work; the oldest app version it
// accepts; and its release. Asked at start and again when the tab comes back
// (at most every few minutes); the last answer is kept for offline starts.
// Until it is known, every feature counts as off (no buttons that then vanish).
//
// A newer release on the server than the one this app was built from means a
// deploy happened while the tab was open: the gentle reload banner says so.
// An app older than minClientVersion gets the same banner (writes are also
// refused with 426 until it reloads).

import { useSyncExternalStore } from "react";
import { APP_VERSION } from "../version";
import { reloadNeeded } from "./store";

export interface Features {
  /** Perennial AI (words from your own texts, new sentences). */
  ai: boolean;
}
interface ServerInfo {
  release: string;
  minClientVersion: string;
  features: Features;
}

const KEY = "perennial-server";
const OFF: Features = { ai: false };

let features: Features = cached() ?? OFF;
const listeners = new Set<() => void>();
let fetched = false;

function cached(): Features | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null") as ServerInfo | null;
    return v?.features ? { ...OFF, ...v.features } : null;
  } catch {
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
  try {
    const res = await fetch("/api/server");
    if (!res.ok) return;
    const info = (await res.json()) as ServerInfo;
    try {
      localStorage.setItem(KEY, JSON.stringify(info));
    } catch {
      // Not kept for next time; fine.
    }
    features = { ...OFF, ...info.features };
    for (const l of listeners) l();
    if (!versionAtLeast(APP_VERSION, info.minClientVersion) || newDeploy(info.release)) reloadNeeded.dispatchEvent(new Event("reload"));
  } catch {
    // Offline: keep the last known answer.
  }
}

/** The commit this app was built from ("dev" locally). */
const BUILT = (import.meta.env.VITE_RELEASE as string | undefined) || "dev";

/** A different, real release on the server than the one this app came from. */
export function newDeploy(serverRelease: string, built = BUILT): boolean {
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
