// Makes the e2e server's database if it does not exist yet. Each agent worktree has
// its own (web/e2e/worktree.ts); web/playwright.config.ts runs this before the migrations.
//
//   DATABASE_URL=postgres://... bun scripts/e2e-db.ts

import { SQL } from "bun";

const target = process.env.DATABASE_URL;
if (!target) throw new Error("DATABASE_URL must be set");
const url = new URL(target);
const name = url.pathname.slice(1);
// Every Postgres has the "postgres" database, so connect there to make the other one.
url.pathname = "/postgres";
const sql = new SQL(url.toString());
const [found] = await sql`select 1 from pg_database where datname = ${name}`;
if (found === undefined) {
  await sql`create database ${sql(name)}`;
  console.log(`made e2e database ${name}`);
}
await sql.end();
