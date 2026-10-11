import { Database } from "bun:sqlite";

export function openDb(path: string): Database {
  const db = new Database(path, { create: true, strict: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA foreign_keys = ON");
  db.run(`CREATE TABLE IF NOT EXISTS ops (
    seq  INTEGER PRIMARY KEY AUTOINCREMENT,
    ns   TEXT NOT NULL,
    id   TEXT NOT NULL,
    body TEXT NOT NULL,
    UNIQUE (ns, id)
  )`);
  db.run("CREATE INDEX IF NOT EXISTS ops_ns_seq ON ops (ns, seq)");
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    created_at      INTEGER NOT NULL,
    plan            TEXT NOT NULL DEFAULT 'free',
    stripe_customer TEXT UNIQUE,
    sub_status      TEXT,
    sub_period_end  INTEGER
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS login_codes (
    email      TEXT PRIMARY KEY,
    code_hash  TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts   INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 1,
    window_start INTEGER NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL
  )`);
  // Sessions expire after a period without use (see Auth.authenticate).
  const sessionCols = db.query<{ name: string }, []>("PRAGMA table_info(sessions)").all().map((c) => c.name);
  if (!sessionCols.includes("last_seen")) {
    db.run("ALTER TABLE sessions ADD COLUMN last_seen INTEGER");
    db.run("UPDATE sessions SET last_seen = created_at");
  }
  db.run(`CREATE TABLE IF NOT EXISTS usage (
    user_id TEXT NOT NULL,
    period  TEXT NOT NULL,
    credits INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, period)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS daily_usage (
    user_id TEXT NOT NULL,
    day     TEXT NOT NULL,
    kind    TEXT NOT NULL,
    count   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day, kind)
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS spend (
    period TEXT PRIMARY KEY,
    usd    REAL NOT NULL DEFAULT 0
  )`);
  // Shared course content: one row per batch of the frequency list, generated
  // once per (language, native language) and reused by every learner.
  db.run(`CREATE TABLE IF NOT EXISTS course_batches (
    lang       TEXT NOT NULL,
    native     TEXT NOT NULL,
    cursor     INTEGER NOT NULL,
    forms      TEXT NOT NULL,
    words      TEXT NOT NULL,
    model      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (lang, native, cursor)
  )`);
  return db;
}

export const period = (now = new Date()) => now.toISOString().slice(0, 7);
export const day = (now = new Date()) => now.toISOString().slice(0, 10);
