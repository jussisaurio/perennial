// Daily housekeeping. Runs as its own Railway cron service
// (`bun --preload ./instrument.ts src/housekeeping.ts`); an advisory lock keeps two runs from overlapping.
//
// - Anonymous learners with no activity for N days are deleted (their rows
//   cascade). Activity = a session renewed, which happens daily while in use.
// - AI request logs older than 180 days are deleted.
// - Expired sign-in codes and sessions, the per-email code log, and per-IP
//   rate-limit counters older than an hour (the longest window) are deleted.

import { PgClient } from "@effect/sql-pg";
import * as Sentry from "@sentry/bun";
import { Cause, Clock, Context, Effect, Exit, Layer } from "effect";
import { Reactivity } from "effect/reactivity";
import type { SqlError } from "effect/sql/SqlError";
import { AppConfig, loadConfig } from "./config";
import { connection, rowCount, theRow } from "./db";
import { log, LoggerLive } from "./log";

const LOCK = 727_002;

/** What a run removed, or that another run held the lock. */
export type Swept = { anonymousUsers: number; aiRequests: number; codes: number; sessions: number; rateLimits: number } | { skipped: true };

export class Housekeeping extends Context.Service<Housekeeping, { readonly run: () => Effect.Effect<Swept, SqlError> }>()("perennial/Housekeeping") {}

export const HousekeepingLive = Layer.effect(
  Housekeeping,
  Effect.gen(function* () {
    const config = yield* AppConfig;

    const run = Effect.fn("Housekeeping.run")(
      function* () {
        // The advisory lock belongs to one connection: a client with only that
        // one takes it, works and gives it back there (a pool could unlock on
        // another connection and leak it).
        const sql = yield* PgClient.makeClient(connection(config.databaseUrl));
        const { locked } = yield* theRow(sql<{ locked: boolean }>`select pg_try_advisory_lock(${LOCK}) as locked`);
        if (!locked) return { skipped: true } as const;
        return yield* Effect.ensuring(sweep(sql), Effect.orDie(sql`select pg_advisory_unlock(${LOCK})`));
      },
      Effect.scoped,
      Effect.provide(Reactivity.layer),
    );

    const sweep = Effect.fnUntraced(function* (sql: PgClient.PgClient) {
      const t0 = performance.now();
      const now = yield* Clock.currentTimeMillis;
      const cutoff = new Date(now - config.anonymousRetentionDays * 86_400_000);
      const anonymousUsers = yield* rowCount(sql`delete from "user" u where u."isAnonymous" and u."createdAt" < ${cutoff}
        and not exists (select 1 from "session" s where s."userId" = u.id and s."updatedAt" >= ${cutoff})`);
      const aiRequests = yield* rowCount(sql`delete from ai_request where created_at < now() - interval '180 days'`);
      const codes = yield* rowCount(sql`delete from "verification" where "expiresAt" < now()`);
      const sessions = yield* rowCount(sql`delete from "session" where "expiresAt" < now()`);
      yield* sql`delete from mail_log where sent_at < now() - interval '2 days'`;
      // Per-IP rate-limit counters (Better Auth, key = IP + path): none lasts more than an hour.
      const rateLimits = yield* rowCount(sql`delete from "rateLimit" where "lastRequest" < ${now - 3_600_000}`);
      const result = { anonymousUsers, aiRequests, codes, sessions, rateLimits };
      // The job's one wide line: what it removed and how long it took.
      yield* Effect.logInfo("housekeeping").pipe(Effect.annotateLogs({ ...result, ms: Math.round(performance.now() - t0) }));
      return result;
    });

    return Housekeeping.of({ run });
  }),
);

if (import.meta.main) {
  const config = loadConfig();
  if (config.production && !process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
  const exit = await Effect.runPromiseExit(
    Effect.flatMap(Housekeeping, (h) => h.run()).pipe(Effect.provide(HousekeepingLive.pipe(Layer.provide(Layer.succeed(AppConfig, config)), Layer.provideMerge(LoggerLive)))),
  );
  if (Exit.isFailure(exit)) {
    // A cron run has no request to hang the error on: report it, then wait
    // for Sentry to send it before the process exits (instrument.ts is preloaded).
    const err = Cause.squash(exit.cause);
    log.error("housekeeping failed", { error: String(err) });
    Sentry.captureException(err);
    await Sentry.flush(5000);
    process.exitCode = 1;
  }
}
