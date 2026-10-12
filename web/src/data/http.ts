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

/**
 * Ask the user to reload when the server needs a newer app. `needed` stays
 * true: the first check at start can fire before the note is on screen.
 */
export const reloadNeeded = new (class extends EventTarget {
  needed = false;
  constructor() {
    super();
    this.addEventListener("reload", () => (this.needed = true));
  }
})();

/** A response's JSON body, or an ApiError when the request failed. */
export async function readResponse(res: Response): Promise<Record<string, unknown>> {
  // An error page (from a proxy, say) has no JSON body: the status still says what failed.
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? `http_${res.status}`), data);
  return data;
}

interface WriteResult {
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
  if (res.status === 426) reloadNeeded.dispatchEvent(new Event("reload"));
  const data = await readResponse(res);
  return { txid: Number(data.txid), changed: data.changed !== false };
}
