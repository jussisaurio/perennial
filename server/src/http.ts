// HTTP helpers: JSON responses, security headers, static files with the
// right caching, and the minimum client version check.

import { join, normalize } from "node:path";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** Read a JSON body of at most `limit` bytes; bigger bodies are refused before parsing. */
export async function readJson(req: Request, limit: number): Promise<unknown> {
  if (Number(req.headers.get("content-length") ?? 0) > limit) throw new HttpError(413, "body_too_large");
  const text = await req.text();
  if (text.length > limit) throw new HttpError(413, "body_too_large");
  try {
    return JSON.parse(text);
  } catch {
    return null; // not JSON: the caller's schema check refuses it (422)
  }
}

export const fail = (status: number, code: string, extra: Record<string, unknown> = {}) => json({ error: code, ...extra }, status);

/** Extra origins the page may talk to (error reporting, analytics), from config.
 *  turnstile: the bot check loads a script and an iframe from Cloudflare. */
export function securityHeaders(connect: string[], https: boolean, turnstile = false): Record<string, string> {
  const cf = turnstile ? " https://challenges.cloudflare.com" : "";
  const csp = [
    "default-src 'self'",
    // The device database (SQLite) runs as WebAssembly.
    `script-src 'self' 'wasm-unsafe-eval'${cf}`,
    // React sets style attributes; the garden sets transforms inline.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // data: — the device database ships its WebAssembly inline and fetches it.
    `connect-src 'self' data: ${connect.join(" ")}`.trim(),
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    `frame-src ${cf ? cf.trim() : "'none'"}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  return {
    "content-security-policy": csp,
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "cross-origin-opener-policy": "same-origin",
    ...(https ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {}),
  };
}

/**
 * Serve the built web app. Hashed assets are immutable; everything else
 * (index.html, the service worker, the manifest) must revalidate so a deploy
 * reaches users. Unknown paths fall back to index.html (hash routing), but a
 * missing file (a path with an extension, e.g. last release's hashed chunk) is
 * a 404: the old client then reloads instead of parsing HTML as JavaScript.
 */
export async function serveStatic(dir: string, pathname: string): Promise<Response> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return new Response("bad request", { status: 400 }); // malformed percent-encoding, e.g. /%E0
  }
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const file = Bun.file(join(dir, rel === "/" ? "index.html" : rel));
  if (rel !== "/" && (await file.exists())) {
    const immutable = rel.startsWith("/assets/") || rel.startsWith("/decks/");
    return new Response(file, { headers: { "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache" } });
  }
  if (/\.[a-z0-9]+$/i.test(rel)) return new Response("not found", { status: 404, headers: { "cache-control": "no-cache" } });
  const index = Bun.file(join(dir, "index.html"));
  return (await index.exists()) ? new Response(index, { headers: { "cache-control": "no-cache" } }) : new Response("not found", { status: 404 });
}

/** "1.4.2" → comparable tuple. Unknown or missing versions count as 0.0.0. */
export function versionAtLeast(version: string | null, min: string): boolean {
  const parse = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [a, b] = [parse(version ?? "0"), parse(min)];
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}
