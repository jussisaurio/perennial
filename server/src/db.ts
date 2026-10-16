// Postgres through @effect/sql-pg: the app's pool, the connection settings
// every client of ours uses, and small helpers for statements.

import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Redacted } from "effect";
import type { Statement } from "effect/sql";
import type { SqlError } from "effect/sql/SqlError";
import { AppConfig } from "./config";

/**
 * How every client of ours connects to `url`: the pool, the housekeeping
 * run's one connection, the tests' own connections.
 *
 * TLS, by the URL's sslmode, in sql-pg 4.0.0:
 * - require: TLS without checking the server's certificate. That is libpq's
 *   meaning, and Bun.SQL's; sql-pg alone would check it, so it is set here.
 * - verify-full: TLS, certificate and host name checked.
 * - verify-ca: the same in sql-pg (libpq does not check the host).
 * - allow, prefer: try TLS, with the certificate checked (libpq does not
 *   check it), and fall back to plain only if the server has no TLS.
 * - none: plain, as in local development.
 * Production uses require or verify-full (docs/DEPLOY.md); both work.
 *
 * 30 s to connect, as Bun.SQL had it (sql-pg's own default is 5 s).
 */
export function connection(url: string): PgClient.PgClientConfig {
  const connectTimeout = "30 seconds";
  // An unreadable URL is sql-pg's to refuse: it says what is wrong with it.
  const sslmode = URL.parse(url)?.searchParams.get("sslmode");
  if (sslmode !== "require") return { url: Redacted.make(url), connectTimeout };
  // Semgrep flags a skipped certificate check. Here it is what the URL asks
  // for (libpq's require); a URL that wants the check says verify-full.
  return { url: Redacted.make(url), connectTimeout, ssl: { rejectUnauthorized: false } }; // nosemgrep: problem-based-packs.insecure-transport.js-node.bypass-tls-verification.bypass-tls-verification
}

/** The app's pool, as Bun.SQL had it: at most 10 connections, idle ones closed after 30 s. */
export const DatabaseLive = Layer.unwrap(
  Effect.map(AppConfig, (config) => PgClient.layer({ ...connection(config.databaseUrl), maxConnections: 10, idleTimeout: "30 seconds" })),
);

/** How many rows a statement touched: the count in Postgres's command tag ("INSERT 0 1", "DELETE 3"). */
export const rowCount = (statement: Statement.Statement<object>): Effect.Effect<number, SqlError> =>
  Effect.flatMap(statement.raw, (raw) =>
    // sql-pg's raw result is its driver Result; anything else is a bug.
    typeof raw === "object" && raw !== null && "rowCount" in raw && typeof raw.rowCount === "number" ? Effect.succeed(raw.rowCount) : Effect.die(new Error("sql-pg returned no row count")),
  );

/** The one row a query always returns (an aggregate, a value): without it, it is a bug. */
export const theRow = <A>(statement: Effect.Effect<ReadonlyArray<A>, SqlError>): Effect.Effect<A, SqlError> =>
  Effect.flatMap(statement, (rows) => {
    const row = rows[0];
    return row === undefined ? Effect.die(new Error("the query returned no row")) : Effect.succeed(row);
  });

