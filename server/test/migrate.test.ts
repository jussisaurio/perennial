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

/** A new, empty database for `body`: `run` applies the pending migrations as a deploy does, `sql` queries it. */
async function withNewDatabase(body: (run: () => Promise<string[]>, sql: <A>(effect: Effect.Effect<A, unknown, PgClient.PgClient>) => Promise<A>) => Promise<void>) {
  const name = `perennial_migrate_${crypto.randomUUID().slice(0, 8)}`;
  const admin = loadConfig().databaseUrl;
  const url = new URL(admin);
  url.pathname = `/${name}`;
  const on = (u: string) => <A>(effect: Effect.Effect<A, unknown, PgClient.PgClient>) => Effect.runPromise(Effect.provide(effect, PgClient.layer(connection(u))));
  const onAdmin = on(admin);
  await onAdmin(Effect.flatMap(PgClient.PgClient, (sql) => sql`create database ${sql(name)}`));
  try {
    const run = Effect.flatMap(Migrations, (m) => m.run()).pipe(
      Effect.provide(MigrationsLive.pipe(Layer.provide(DatabaseLive), Layer.provide(Layer.succeed(AppConfig, loadConfig({ databaseUrl: url.href }))), Layer.provideMerge(LoggerLive))),
    );
    await body(() => Effect.runPromise(run), on(url.href));
  } finally {
    await onAdmin(Effect.flatMap(PgClient.PgClient, (sql) => sql`drop database ${sql(name)} with (force)`));
  }
}

test("the migrations build a new database, once", () =>
  withNewDatabase(async (run) => {
    expect(await run()).toEqual(["0001_init.sql", "0002_mail_log.sql", "0003_course_door.sql", "0004_user_word_forms_list.sql"]);
    expect(await run()).toEqual([]);
  }));

test("0004 turns forms stored as a JSON list's text into the list, and leaves any other string as it is (#337)", () =>
  withNewDatabase(async (run, db) => {
    await run();
    // Rows as /api/write stored them before #340 (a jsonb string holding the list's JSON text), odd
    // strings, and a list. Then 0004 runs again, as on a deploy where it is pending. `nul` is what
    // JSON.stringify(["a\0"]) gives: valid json, but not valid jsonb, like a lone surrogate.
    const stored = { list: '["zorro","zorros"]', empty: "[]", notJson: "zorro", notList: '"zorro"', nul: '["a\\u0000"]', surrogate: '["\\ud800"]' };
    await db(
      Effect.flatMap(PgClient.PgClient, (sql) =>
        Effect.gen(function* () {
          const [user] = yield* sql<{ id: string }>`insert into "user" (name, email, "emailVerified") values ('', 'forms@example.com', false) returning id`;
          for (const [lemma, text] of Object.entries(stored)) yield* sql`insert into user_word (id, user_id, lang, lemma, gloss, forms) values (${crypto.randomUUID()}, ${user!.id}, 'es', ${lemma}, '', to_jsonb(${text}::text))`;
          yield* sql`insert into user_word (id, user_id, lang, lemma, gloss, forms) values (${crypto.randomUUID()}, ${user!.id}, 'es', 'already', '', '["zorro"]'::jsonb)`;
          yield* sql`delete from schema_migrations where name = '0004_user_word_forms_list.sql'`;
        }),
      ),
    );
    expect(await run()).toEqual(["0004_user_word_forms_list.sql"]);
    const rows = await db(Effect.flatMap(PgClient.PgClient, (sql) => sql<{ lemma: string; kind: string; forms: unknown }>`select lemma, jsonb_typeof(forms) as kind, forms from user_word order by lemma`));
    expect(rows).toEqual([
      { lemma: "already", kind: "array", forms: ["zorro"] },
      { lemma: "empty", kind: "array", forms: [] },
      { lemma: "list", kind: "array", forms: ["zorro", "zorros"] },
      // Left for the app, which reads them as no forms and reports it once (web/src/data/rows.ts).
      { lemma: "notJson", kind: "string", forms: "zorro" },
      { lemma: "notList", kind: "string", forms: '"zorro"' },
      { lemma: "nul", kind: "string", forms: stored.nul },
      { lemma: "surrogate", kind: "string", forms: stored.surrogate },
    ]);
  }));
