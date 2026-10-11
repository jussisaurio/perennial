// Daily housekeeping. Runs as its own Railway cron service
// (`bun --preload ./instrument.ts src/housekeeping.ts`); an advisory lock keeps two runs from overlapping.
//
// - Anonymous learners with no activity for N days are deleted (their rows
//   cascade). Activity = a session renewed, which happens daily while in use.
// - AI request logs older than 180 days are deleted.
// - Expired sign-in codes and sessions are deleted.

import type { SQL } from "bun";
import type { Config } from "./config";
import { log } from "./log";

const LOCK = 727_002;

export async function housekeeping(sql: SQL, config: Config) {
  const [{ locked }] = await sql`select pg_try_advisory_lock(${LOCK}) as locked`;
  if (!locked) return { skipped: true };
  try {
    const cutoff = new Date(Date.now() - config.anonymousRetentionDays * 86_400_000);
    const anonymous = await sql`delete from "user" u where u."isAnonymous" and u."createdAt" < ${cutoff}
      and not exists (select 1 from "session" s where s."userId" = u.id and s."updatedAt" >= ${cutoff})`;
    const logs = await sql`delete from ai_request where created_at < now() - interval '180 days'`;
    const codes = await sql`delete from "verification" where "expiresAt" < now()`;
    const sessions = await sql`delete from "session" where "expiresAt" < now()`;
    const result = { anonymousUsers: anonymous.count, aiRequests: logs.count, codes: codes.count, sessions: sessions.count };
    log.info("housekeeping", result);
    return result;
  } finally {
    await sql`select pg_advisory_unlock(${LOCK})`;
  }
}

if (import.meta.main) {
  const { loadConfig } = await import("./config");
  const config = loadConfig();
  if (config.production && !process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
  const sql = new Bun.SQL(config.databaseUrl, { max: 1 });
  try {
    await housekeeping(sql, config);
  } catch (err) {
    // A cron run has no request to hang the error on: report it, then wait
    // for Sentry to send it before the process exits (instrument.ts is preloaded).
    log.error("housekeeping failed", { error: String(err) });
    const Sentry = await import("@sentry/bun");
    Sentry.captureException(err);
    await Sentry.flush(5000);
    process.exitCode = 1;
  } finally {
    await sql.close();
  }
}
