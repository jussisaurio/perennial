// Plain SQL migrations: server/migrations/NNNN_name.sql, applied in order in
// one transaction (all pending or none), recorded in schema_migrations. An advisory lock
// makes it safe when several instances start at once.
//
// Rule: expand, then contract. A migration must keep the previous app
// version working (add columns and tables; drop only in a later release).

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/sql/SqlError";
import { AppConfig, loadConfig } from "./config";
import { DatabaseLive } from "./db";
import { LoggerLive } from "./log";

const DIR = join(import.meta.dir, "../migrations");
const LOCK = 727_001; // any constant shared by all instances
/** The start of a dollar-quoted body: $$ or $name$. */
const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * The statements in a migration file, in order. sql-pg sends each statement on
 * its own (Postgres's extended protocol takes one at a time), so a file is split
 * at each `;` that ends a statement: not one inside a comment, a quoted string
 * or identifier, or a dollar-quoted body. Pieces with only comments are dropped.
 * (Backslash escapes in E'' strings are not read: no migration has one.)
 */
export function statements(file: string): string[] {
  const out: string[] = [];
  let start = 0;
  let code = false; // the current piece has more than comments and space
  let i = 0;
  const skipTo = (end: string, from: number) => {
    const at = file.indexOf(end, from);
    return at < 0 ? file.length : at + end.length;
  };
  while (i < file.length) {
    const c = file[i];
    if (file.startsWith("--", i)) i = skipTo("\n", i);
    else if (file.startsWith("/*", i)) i = skipTo("*/", i + 2);
    else if (c === "'" || c === '"') {
      // A doubled quote inside is the quote itself: the scan just reopens.
      i = skipTo(c, i + 1);
      code = true;
    } else if (c === "$" && DOLLAR_TAG.test(file.slice(i))) {
      const tag = file.slice(i, file.indexOf("$", i + 1) + 1);
      i = skipTo(tag, i + tag.length);
      code = true;
    } else if (c === ";") {
      if (code) out.push(file.slice(start, i).trim());
      start = ++i;
      code = false;
    } else {
      if (c !== undefined && !/\s/.test(c)) code = true;
      i++;
    }
  }
  if (code) out.push(file.slice(start).trim());
  return out;
}

export class Migrations extends Context.Service<Migrations, { readonly run: () => Effect.Effect<string[], SqlError> }>()("perennial/Migrations") {}

export const MigrationsLive = Layer.effect(
  Migrations,
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;

    const run = Effect.fn("Migrations.run")(function* () {
      const files = (yield* Effect.promise(() => readdir(DIR))).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`select pg_advisory_xact_lock(${LOCK})`;
          yield* sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
          const done = new Set((yield* sql<{ name: string }>`select name from schema_migrations`).map((r) => r.name));
          const applied: string[] = [];
          for (const file of files) {
            if (done.has(file)) continue;
            // Unprepared: each runs once, so there is nothing to keep prepared.
            for (const statement of statements(yield* Effect.promise(() => Bun.file(join(DIR, file)).text()))) yield* sql.unsafe(statement).unprepared;
            yield* sql`insert into schema_migrations (name) values (${file})`;
            applied.push(file);
            yield* Effect.logInfo("migration applied").pipe(Effect.annotateLogs({ file }));
          }
          return applied;
        }),
      );
    });

    return Migrations.of({ run });
  }),
);

if (import.meta.main) {
  const applied = await Effect.runPromise(
    Effect.flatMap(Migrations, (migrations) => migrations.run()).pipe(
      Effect.provide(MigrationsLive.pipe(Layer.provide(DatabaseLive), Layer.provide(Layer.succeed(AppConfig, loadConfig())), Layer.provideMerge(LoggerLive))),
    ),
  );
  console.log(applied.length ? `applied ${applied.join(", ")}` : "up to date");
}
