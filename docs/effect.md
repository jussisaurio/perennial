# Effect in Perennial

We use [Effect](https://effect.website) where the code does I/O. Errors, timeouts, retries and clean-up then become part of the types, and tests can swap the parts. The plan and the reasons are in [#322](https://github.com/jussisaurio/perennial/issues/322).

**Version:** `effect` **4.0.0** and `@effect/platform-bun` **4.0.0**, pinned exactly (no `^`). The root `package.json` also pins `@effect/platform-node-shared` to 4.0.0, so the whole family is one version. Upgrade them together, on purpose, in their own PR.

**How we write it:** we follow kitlangton's [effect skill](https://github.com/kitlangton/skills/tree/main/skills/effect). When the skill and the installed package disagree, the package wins: read the `.d.ts` files in `node_modules` before you guess an API.

## Where Effect is used, and where it is not

| Part | Effect? | Why |
|---|---|---|
| Server (`server/`) | Yes | Its whole job is I/O: auth, database, AI spend, a streaming proxy. |
| Wire contract (`contract/`) | Yes, Schema | One schema for every request body, answer and error code. The server decodes with it; the app will too. |
| The app's I/O (`web/src/data/*`) | Yes | Timeouts, the tab lock and the server's errors become types. |
| Pure code (`core/*`, `content/*`, FSRS, the planner) | No | It is pure and takes `now` as an argument. Effect would only add noise. |
| React, TanStack DB, Electric wiring | No | They have the shape of their frameworks. Effect starts at the functions they call. |
| The 3D garden | No | A frame loop gains nothing from fibers. |

Inside Effect code, plain TypeScript is fine: `null`, `if`, loops. We do not use `Option` everywhere or long point-free pipes.

### Where the server is now (#322, part 1)

- **Effect:** the HTTP edge (`server/src/app.ts`), settings (`config.ts`), logging and the request's context (`log.ts`, `request.ts`), the services and their layers (`services.ts`), and the start and stop of the process (`index.ts`).
- **Not yet:** `sync.ts`, `ai.ts`, `auth.ts`, `housekeeping.ts` and `migrate.ts` are still Promise code on `Bun.SQL`. The edge calls them through `promise()` in `request.ts`. Part 2 makes them Effect services on `@effect/sql-pg`.

### Where the app is now (#322, part 4)

- **Effect:** `data/http.ts` (one `fetch` wrapper: answers and errors are checked with the contract, and errors are typed), `data/auth.ts` (deadlines for sign-in requests), `data/tabLock.ts` (the Web Lock as a scoped resource), and the write in `data/store.ts`.
- **At the edge:** each exported function runs its Effect with `Effect.runPromise`. React and TanStack DB still get Promises. `runPromise` rejects with the typed error itself, so `instanceof ApiError` works there.
- **Plain on purpose:** the voice wait in `ui/speech.ts`, the wait for an answer in `ui/useSessionRunner.ts`, the bot check in `data/captcha.ts`, the deck loader's cache in `data/deck.ts`, and the visibility check in `data/server.ts`. Effect would only add words there.
- **Not `effect/http`:** a small `fetch` wrapper costs much less in the bundle, and we only need one POST and a few GETs.

## The patterns, one example each

**A service and its layer.** The service is a class; its layer makes it and closes it.

```ts
export class Database extends Context.Service<Database, SQL>()("perennial/Database") {}

export const DatabaseLive = Layer.effect(
  Database,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    return yield* Effect.acquireRelease(
      Effect.sync(() => new Bun.SQL(config.databaseUrl)),
      (sql) => Effect.promise(() => sql.close()),
    );
  }),
);
```

Tests give their own value with `Layer.succeed(Database, sql)`.

**A named operation.** Use `Effect.fn("Domain.operation")`. The name shows in traces.

```ts
const readJson = Effect.fn("Http.readJson")(function* (req: Request, limit: number) {
  if (Number(req.headers.get("content-length") ?? 0) > limit) return yield* refuse({ error: "body_too_large" });
  // …
});
```

**A typed error.** Use `Schema.TaggedError`. The server has one: `ApiError`, with a body from the contract's error union. `errorResponse` in `http.ts` is the one place that turns it into a response.

```ts
export class ApiError extends Schema.TaggedError<ApiError>()("ApiError", { body: ApiErrorBody }) {}

if (!user) return yield* refuse({ error: "sign_in_required" });
```

**Settings.** Read the environment with `Config`, in a layer, not with `process.env` in app code.

```ts
const variable = (name: string) => Config.option(Config.String(name)).pipe(Config.map(Option.getOrUndefined));
```

**Decode at the boundary.** Untrusted input goes through a Schema once, where it comes in. After that the types are true.

```ts
const { mutations } = yield* decodeBody(request, WriteBatch, 512 * 1024);
```

A failed decode is `422 bad_request`. Do not cast to skip a check. Ids that are easy to mix up are branded (`UserId`, `WordId` in `contract/ids.ts`).

## Rules that are easy to miss

- **No AsyncLocalStorage in Effect code.** Fibers do not keep it, and the scheduler can run several requests' fibers in one callback. The request's facts live in `RequestContext` (`request.ts`), passed through Effect. The edge reads Sentry's scopes once, when the request comes in, and passes them on.
- **Promise code gets the request explicitly.** `promise()` in `request.ts` sets the request (for `event()` and `log`) and its Sentry scopes at the start of each Promise call, and that code reads them only inside its own promise chain.
- **A request runs to its end.** Bun's server interrupts a request's fiber when the client goes away. A write, an AI call, an account deletion or a sign-in that merges accounts must still finish. Effect's `HttpEffect.toHandled` makes the whole request fiber uninterruptible from its start, so the edge, Better Auth and static files are safe. `HttpRouter` makes each route interruptible again, so every route sets `uninterruptible: true`. Never wrap the edge or a route in `Effect.interruptible` or `Effect.timeout`. `server/test/disconnect.test.ts` checks this.
- **Logs:** `Effect.logInfo("request").pipe(Effect.annotateLogs({ … }))` writes the same JSON line as before. The request's fields come from `RequestContext`. Never put emails, codes or request bodies in a log.
