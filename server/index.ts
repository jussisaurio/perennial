// Perennial server: auth, sync (Electric proxy + writes), Perennial AI, and
// the built web app from ../web/dist. Configuration: see src/config.ts.
// Error reporting is set up in instrument.ts (preloaded, see package.json).

import { BunRuntime } from "@effect/platform-bun";
import * as Sentry from "@sentry/bun";
import { Cause, Effect, Exit, Layer } from "effect";
import { HttpServer } from "effect/http";
import { AppLive, BunServerLive, HttpLive } from "./src/app";
import { AppConfig, AppConfigFromEnv, ConfigProblems } from "./src/config";
import { log, LoggerLive } from "./src/log";
import { Ai, DatabaseLive, ServicesLive } from "./src/services";
import { watchEventLoop } from "./src/watchdog";

const Server = Layer.unwrap(Effect.map(AppConfig, (config) => BunServerLive(config.port)));

const Started = Layer.effectDiscard(
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer;
    const config = yield* AppConfig;
    const ai = yield* Ai;
    // A port (Server above), never a Unix socket; the path would say so.
    const url = server.address._tag === "UnixPathAddress" ? server.address.path : `http://localhost:${server.address.port}`;
    yield* Effect.logInfo("perennial server started").pipe(
      Effect.annotateLogs({
        url,
        release: config.release,
        ai: ai.enabled ? config.anthropic.model : "off",
        mail: config.dev ? "dev outbox" : "resend",
        electric: config.electric.url,
      }),
    );
  }),
);

const Watchdog = Layer.effectDiscard(Effect.acquireRelease(Effect.sync(watchEventLoop), (stop) => Effect.sync(stop)));

const Main = Layer.mergeAll(Started, Watchdog).pipe(
  Layer.provide(HttpLive),
  // The server starts listening last, once the app can answer.
  Layer.provideMerge(Server),
  Layer.provideMerge(AppLive),
  Layer.provideMerge(ServicesLive),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(AppConfigFromEnv),
  Layer.provide(LoggerLive),
);

// runMain stops the server on SIGTERM and SIGINT: it stops taking requests,
// lets the open ones finish, then closes the pools. This line says why.
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => log.info("shutting down", { signal }));

BunRuntime.runMain(Layer.launch(Main), {
  // We report a failure ourselves (below), as a JSON line and to Sentry.
  disableErrorReporting: true,
  teardown: (exit, onExit) => {
    // A shutdown on a signal is a clean exit.
    const failed = Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause);
    if (failed) {
      // A server that can't start (a busy port, a throw while building a service) or can't stop cleanly.
      const err = Cause.squash(exit.cause);
      // Config problems are logged one per line already, and were never sent as exceptions.
      if (!(err instanceof ConfigProblems)) {
        log.error("server stopped", { err });
        Sentry.captureException(err);
      }
    }
    // runMain exits as soon as onExit is called: let the report reach Sentry first.
    void Sentry.flush(2000).then(() => onExit(failed ? 1 : 0));
  },
});
