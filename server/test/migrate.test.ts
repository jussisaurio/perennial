// Migrations: each file is split into statements (Postgres's extended protocol
// takes one at a time), and the files still build a database from nothing.

import { expect, test } from "bun:test";
import { PgClient } from "@effect/sql-pg";
import { Effect, Layer } from "effect";
import { AppConfig, loadConfig } from "../src/config";
import { connection, DatabaseLive } from "../src/db";
import { LoggerLive } from "../src/log";
import { Migrations, MigrationsLive, statements } from "../src/migrate";

process.env.LOG_LEVEL ??= "silent";

test("a file splits at the semicolons that end statements", () => {
  const file = `-- a comment; not an end
create table a (x text default 'a;b', "odd;name" int);
/* a block; comment */
create function f() returns int as $body$ select 1; $body$ language sql;
do $$ begin perform 1; end $$;
insert into a (x) values ('it''s; fine')
-- the last one has no semicolon; the comment after it is not a statement`;
  expect(statements(file)).toEqual([
    `-- a comment; not an end\ncreate table a (x text default 'a;b', "odd;name" int)`,
    `/* a block; comment */\ncreate function f() returns int as $body$ select 1; $body$ language sql`,
    `do $$ begin perform 1; end $$`,
    `insert into a (x) values ('it''s; fine')\n-- the last one has no semicolon; the comment after it is not a statement`,
  ]);
  expect(statements("-- only a comment;\n\n")).toEqual([]);
});

test("the migrations build a new database, once", async () => {
  const name = `perennial_migrate_${crypto.randomUUID().slice(0, 8)}`;
  const admin = loadConfig().databaseUrl;
  const url = new URL(admin);
  url.pathname = `/${name}`;
  const onAdmin = <A>(effect: Effect.Effect<A, unknown, PgClient.PgClient>) => Effect.runPromise(Effect.provide(effect, PgClient.layer(connection(admin))));
  await onAdmin(Effect.flatMap(PgClient.PgClient, (sql) => sql`create database ${sql(name)}`));
  try {
    const run = Effect.flatMap(Migrations, (m) => m.run()).pipe(
      Effect.provide(MigrationsLive.pipe(Layer.provide(DatabaseLive), Layer.provide(Layer.succeed(AppConfig, loadConfig({ databaseUrl: url.href }))), Layer.provideMerge(LoggerLive))),
    );
    expect(await Effect.runPromise(run)).toEqual(["0001_init.sql", "0002_mail_log.sql", "0003_course_door.sql", "0004_user_word_forms_list.sql"]);
    expect(await Effect.runPromise(run)).toEqual([]);
  } finally {
    await onAdmin(Effect.flatMap(PgClient.PgClient, (sql) => sql`drop database ${sql(name)} with (force)`));
  }
});
