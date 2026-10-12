// Talking to our server: one error type for every call, and the one way to
// send writes (the offline queue, starting a course, the dev demo).

import { APP_VERSION } from "../version";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: Record<string, unknown>;
  constructor(status: number, code: string, detail: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
  /** Invalid, or over a storage limit: sending it again would never succeed. */
  get permanent(): boolean {
    return this.status === 422 || this.status === 413 || (this.status === 429 && this.code === "quota");
  }
}

/** Ask the user to reload when the server needs a newer app. */
export const reloadNeeded = new EventTarget();

export interface WriteResult {
  txid: number;
  /** False when the write changed nothing, so no echo will come through sync. */
  changed: boolean;
}

/** Send changes in the server's mutation format (see server/src/sync.ts). */
export async function postWrite(mutations: unknown[], opts: { idempotencyKey?: string } = {}): Promise<WriteResult> {
  const res = await fetch("/api/write", {
    method: "POST",
    headers: { "content-type": "application/json", "x-perennial-version": APP_VERSION, "idempotency-key": opts.idempotencyKey ?? crypto.randomUUID() },
    body: JSON.stringify({ mutations }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 426) reloadNeeded.dispatchEvent(new Event("reload"));
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? `http_${res.status}`), data);
  return { txid: Number(data.txid), changed: data.changed !== false };
}
