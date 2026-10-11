// Plain SQL migrations: server/migrations/NNNN_name.sql, applied in order in
// one transaction (all pending or none), recorded in schema_migrations. An advisory lock
// makes it safe when several instances start at once.
//
// Rule: expand, then contract. A migration must keep the previous app
// version working (add columns and tables; drop only in a later release).

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { SQL } from "bun";
import { log } from "./log";

const DIR = join(import.meta.dir, "../migrations");
const LOCK = 727_001; // any constant shared by all instances

export async function migrate(sql: SQL): Promise<string[]> {
  const files = (await readdir(DIR)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK})`;
    await tx`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
    const done = new Set((await tx`select name from schema_migrations`).map((r: { name: string }) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      await tx.unsafe(await Bun.file(join(DIR, file)).text());
      await tx`insert into schema_migrations (name) values (${file})`;
      applied.push(file);
      log.info("migration applied", { file });
    }
  });
  return applied;
}

if (import.meta.main) {
  const url = process.env.DATABASE_URL ?? "postgres://perennial:perennial@localhost:55432/perennial";
  const sql = new Bun.SQL(url);
  const applied = await migrate(sql);
  console.log(applied.length ? `applied ${applied.join(", ")}` : "up to date");
  await sql.close();
}
