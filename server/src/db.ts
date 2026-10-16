// Postgres through @effect/sql-pg: the app's pool, the connection settings
// every client of ours uses, and small helpers for statements.

import { PgClient } from "@effect/sql-pg";
import { Effect, Layer, Redacted } from "effect";
import type { Statement } from "effect/sql";
import type { SqlError } from "effect/sql/SqlError";
import { AppConfig } from "./config";

/**
 * How we connect to `url`.
 *
 * libpq's sslmode=require, which production uses (docs/DEPLOY.md), means TLS
 * without checking the server's certificate, and Bun.SQL kept that meaning.
 * sql-pg 4.0.0 checks the certificate for `require`, so we keep libpq's
 * meaning here. verify-ca and verify-full check it, as before. (sql-pg's
 * `prefer` also checks it, where libpq does not; nothing of ours uses it.)
 */
export function connection(url: string): PgClient.PgClientConfig {
  // An unreadable URL is sql-pg's to refuse: it says what is wrong with it.
  const sslmode = URL.parse(url)?.searchParams.get("sslmode");
  return { url: Redacted.make(url), ...(sslmode === "require" ? { ssl: { rejectUnauthorized: false } } : {}) };
}

/** The app's pool, as Bun.SQL had it: at most 10 connections, idle ones closed after 30 s, 30 s to connect. */
export const DatabaseLive = Layer.unwrap(
  Effect.map(AppConfig, (config) =>
    PgClient.layer({ ...connection(config.databaseUrl), maxConnections: 10, idleTimeout: "30 seconds", connectTimeout: "30 seconds" }),
  ),
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

