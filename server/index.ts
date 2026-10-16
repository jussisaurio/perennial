// Perennial server: auth, sync (Electric proxy + writes), Perennial AI, and
// the built web app from ../web/dist. Configuration: see src/config.ts.
// Error reporting is set up in instrument.ts (preloaded, see package.json).

import { BunRuntime } from "@effect/platform-bun";
import { Cause, Effect, Exit, Layer, Logger } from "effect";
import { HttpServer } from "effect/http";
import { AppLive, BunServerLive, HttpLive } from "./src/app";
import { AppConfig, AppConfigFromEnv } from "./src/config";
import { log, logger } from "./src/log";
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
  Layer.provideMerge(AppLive),
  Layer.provideMerge(Server),
  Layer.provideMerge(ServicesLive),
  Layer.provideMerge(DatabaseLive),
  Layer.provideMerge(AppConfigFromEnv),
  Layer.provide(Logger.layer([logger])),
);

// runMain stops the server on SIGTERM and SIGINT: it stops taking requests,
// lets the open ones finish, then closes the pools. This line says why.
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => log.info("shutting down", { signal }));

BunRuntime.runMain(Layer.launch(Main), {
  // A shutdown on a signal is a clean exit.
  teardown: (exit, onExit) => onExit(Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause) ? 0 : 1),
});
