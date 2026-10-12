// What the server says about itself (GET /api/server): what it can do right
// now, so the app shows only features that work, and the oldest app version it
// accepts. Fetched once per page; the last answer is kept for offline starts.
// Until it is known, every feature counts as off (no buttons that then vanish).

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
    // An app older than the server accepts: say so now, not after a failed write.
    if (!versionAtLeast(APP_VERSION, info.minClientVersion)) reloadNeeded.dispatchEvent(new Event("reload"));
  } catch {
    // Offline: keep the last known answer.
  }
}

/** Ask the server once per page (main.tsx calls this at start; the hook too, if first). */
export function loadServerInfo() {
  if (fetched) return;
  fetched = true;
  void load();
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
