// The server's dependencies as Effect services, each with the layer that makes
// it and closes it. They wrap today's modules (Bun.SQL, mail.ts, auth.ts,
// ai.ts) as they are; #322 part 2 turns those into Effect services too.

import { PgClient } from "@effect/sql-pg";
import type { SQL } from "bun";
import { Context, Effect, Layer } from "effect";
import { AIService } from "./ai";
import { createAuth } from "./auth";
import { AppConfig } from "./config";
import { Mail, MailLive } from "./mail";
import { WordsLive } from "./words";

export class Database extends Context.Service<Database, SQL>()("perennial/Database") {}

/** Bun.SQL, for the modules not yet on sql-pg (db.ts). Tests pass their own (Layer.succeed). */
export const BunSqlLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    return yield* Effect.acquireRelease(
      Effect.sync(() => new Bun.SQL(config.databaseUrl, { max: 10, idleTimeout: 30 })),
      (sql) => Effect.promise(() => sql.close()),
    );
  }),
);

type BetterAuth = ReturnType<typeof createAuth>["auth"];
export class Auth extends Context.Service<Auth, BetterAuth>()("perennial/Auth") {}

/** Better Auth, with its own small pg pool (closed with the layer). */
const AuthLive = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const sql = yield* PgClient.PgClient;
    const mailer = yield* Mail;
    const { auth } = yield* Effect.acquireRelease(
      Effect.sync(() => createAuth(config, sql, mailer)),
      ({ pool }) => Effect.promise(() => pool.end()),
    );
    return auth;
  }),
);

export class Ai extends Context.Service<Ai, AIService>()("perennial/Ai") {}

const AiLive = Layer.effect(
  Ai,
  Effect.gen(function* () {
    return new AIService(yield* Database, yield* AppConfig);
  }),
);

/** Mail, auth, AI and the deck words, on a database and settings from elsewhere. */
export const ServicesLive = Layer.mergeAll(AuthLive, AiLive, WordsLive).pipe(Layer.provideMerge(MailLive));
