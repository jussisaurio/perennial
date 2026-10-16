// The app's services, put together: Better Auth (its own Promise API, wrapped
// here), and the Effect services from their modules (mail, sync, AI, the deck
// words). Each layer closes what it opened.

import { PgClient } from "@effect/sql-pg";
import { Context, Effect, Layer } from "effect";
import { AiLive } from "./ai";
import { createAuth } from "./auth";
import { AppConfig } from "./config";
import { Mail, MailLive } from "./mail";
import { ModelLive } from "./model";
import { SyncLive } from "./sync";
import { WordsLive } from "./words";

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

/** Mail, auth, sync, AI and the deck words, on a database and settings from elsewhere. */
export const ServicesLive = Layer.mergeAll(AuthLive, AiLive.pipe(Layer.provide(ModelLive))).pipe(
  Layer.provideMerge(SyncLive),
  Layer.provideMerge(WordsLive),
  Layer.provideMerge(MailLive),
);
