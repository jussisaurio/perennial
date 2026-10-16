// HTTP helpers: JSON answers, the one error type and its response, request
// bodies decoded with the wire contract, security headers, static files with
// the right caching, and the minimum client version check.

import { join, normalize } from "node:path";
import { Effect, Schema, SchemaIssue } from "effect";
import { HttpServerResponse } from "effect/http";
import { ApiErrorBody, ERROR_STATUS } from "perennial-contract";

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => HttpServerResponse.jsonUnsafe(body, { status, headers });

/**
 * A request the server refuses, with one of the contract's error bodies: the
 * typed failure of the routes and services. errorResponse is the one place it
 * becomes a response.
 */
export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", { body: ApiErrorBody }) {}

export const refuse = (body: ApiErrorBody) => new ApiError({ body });

export function errorResponse(body: ApiErrorBody) {
  const res = json(body, ERROR_STATUS[body.error]);
  // The rest of a too-large body is never read: close the connection so the
  // client does not send its next request down the broken socket.
  return body.error === "body_too_large" ? HttpServerResponse.setHeader(res, "connection", "close") : res;
}

/** Read a JSON body of at most `limit` bytes; bigger bodies are refused before parsing. */
const readJson = Effect.fn("Http.readJson")(function* (req: Request, limit: number) {
  if (Number(req.headers.get("content-length") ?? 0) > limit) return yield* refuse({ error: "body_too_large" });
  // A body that can't be read is a bug or a broken connection: a defect (500), not a refusal.
  const text = yield* Effect.promise(() => req.text());
  if (text.length > limit) return yield* refuse({ error: "body_too_large" });
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null; // not JSON: the schema refuses it (422)
  }
});

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

/** A request body, decoded with its contract schema. 422 bad_request says what was wrong (at most five issues). */
export const decodeBody = Effect.fn("Http.decodeBody")(function* <S extends Schema.Decoder<unknown>>(req: Request, schema: S, limit: number) {
  const input = yield* readJson(req, limit);
  return yield* Schema.decodeUnknownEffect(schema)(input, { errors: "all" }).pipe(
    Effect.catchTag("SchemaError", (e) =>
      refuse({
        error: "bad_request",
        issues: formatIssues(e.issue)
          .issues.slice(0, 5)
          .map((i) => ({ message: i.message, path: (i.path ?? []).map((p) => (typeof p === "object" ? String(p.key) : typeof p === "number" ? p : String(p))) })),
      }),
    ),
  );
});

/** Extra origins the page may talk to (error reporting, analytics), from config.
 *  turnstile: the bot check loads a script and an iframe from Cloudflare. */
export function securityHeaders(connect: string[], https: boolean, turnstile = false): Record<string, string> {
  const cf = turnstile ? " https://challenges.cloudflare.com" : "";
  const csp = [
    "default-src 'self'",
    `script-src 'self'${cf}`,
    // React sets style attributes; the garden sets transforms inline.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' ${connect.join(" ")}`.trim(),
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
 * (index.html, the manifest) must revalidate so a deploy reaches users.
 * Unknown paths fall back to index.html (hash routing), but a missing file (a
 * path with an extension, e.g. last release's hashed chunk) is a 404: the old
 * client then reloads instead of parsing HTML as JavaScript.
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
