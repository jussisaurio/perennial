// The server's dependencies as Effect services, each with the layer that makes
// it and closes it. They wrap today's modules (Bun.SQL, mail.ts, auth.ts,
// ai.ts) as they are; #322 part 2 turns those into Effect services too.

import type { SQL } from "bun";
import { Context, Effect, Layer } from "effect";
import { AIService } from "./ai";
import { createAuth } from "./auth";
import { AppConfig } from "./config";
import { createMailer, type Mailer } from "./mail";

export class Database extends Context.Service<Database, SQL>()("perennial/Database") {}

/** The app's Postgres pool. Tests pass their own (Layer.succeed). */
export const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    return yield* Effect.acquireRelease(
      Effect.sync(() => new Bun.SQL(config.databaseUrl, { max: 10, idleTimeout: 30 })),
      (sql) => Effect.promise(() => sql.close()),
    );
  }),
);

export class Mail extends Context.Service<Mail, Mailer>()("perennial/Mail") {}

const MailLive = Layer.effect(Mail, Effect.map(AppConfig, createMailer));

type BetterAuth = ReturnType<typeof createAuth>["auth"];
export class Auth extends Context.Service<Auth, BetterAuth>()("perennial/Auth") {}

/** Better Auth, with its own small pg pool (closed with the layer). */
const AuthLive = Layer.effect(
  Auth,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const sql = yield* Database;
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

/** Mail, auth and AI, on a database and settings from elsewhere. */
export const ServicesLive = Layer.mergeAll(AuthLive, AiLive).pipe(Layer.provideMerge(MailLive));
