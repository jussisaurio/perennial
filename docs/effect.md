# Effect in Perennial

We use [Effect](https://effect.website) where the code does I/O. Errors, timeouts, retries and clean-up then become part of the types, and tests can swap the parts. The plan and the reasons are in [#322](https://github.com/jussisaurio/perennial/issues/322).

**Version:** `effect` **4.0.0**, `@effect/platform-bun` **4.0.0** and `@effect/sql-pg` **4.0.0**, pinned exactly (no `^`). The root `package.json` also pins `@effect/platform-node-shared` to 4.0.0, so the whole family is one version. Upgrade them together, on purpose, in their own PR.

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

### The server (#322, parts 1 and 2)

- **Effect:** the HTTP edge (`server/src/app.ts`), settings (`config.ts`), logging and the request's context (`log.ts`, `request.ts`), the start and stop of the process (`index.ts`), and every service: Postgres (`db.ts`, on `@effect/sql-pg`), `Sync`, `Ai` and the model adapter `Model` (`model.ts`), `Mail`, `Words` (the deck word ids, read at start), `Migrations`, `Housekeeping` and the event-loop watchdog. `services.ts` puts them together.
- **Promise code, on purpose:** Better Auth (its hooks call our Effects with `Effect.runPromise`), `instrument.ts` (Sentry's preload), and the pure helpers (`clientIp.ts`, `course.ts`, `prompts.ts`). `mock-llm.ts` is a test stand-in.
- **Two Postgres pools:** the app's (sql-pg, up to 10) and Better Auth's (`pg`, up to 4). sql-pg 4.0.0 is its own wire-protocol client and cannot share a `pg` pool.

### Where the app is now (#322, part 4)

- **Effect:** `data/http.ts` (one `fetch` wrapper: answers and errors are checked with the contract, and errors are typed), `data/auth.ts` (deadlines for sign-in requests), `data/tabLock.ts` (the Web Lock as a scoped resource), and the write in `data/store.ts`.
- **At the edge:** each exported function runs its Effect with `Effect.runPromise`. React and TanStack DB still get Promises. `runPromise` rejects with the typed error itself, so `instanceof ApiError` works there.
- **Plain on purpose:** the voice wait in `ui/speech.ts`, the wait for an answer in `ui/useSessionRunner.ts`, the bot check in `data/captcha.ts`, the deck loader's cache in `data/deck.ts`, and the visibility check in `data/server.ts`. Effect would only add words there.
- **Not `effect/http`:** a small `fetch` wrapper costs much less in the bundle, and we only need one POST and a few GETs.

## The patterns, one example each

**A service and its layer.** The service is a class with its interface; its layer makes it (and closes what it opens) and returns `Service.of({ ... })`.

```ts
export class Sync extends Context.Service<Sync, { readonly applyWrites: (userId: UserId, mutations: readonly Mutation[]) => Effect.Effect<WriteResult, ApiError, RequestContext> }>()("perennial/Sync") {}

export const SyncLive = Layer.effect(
  Sync,
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    const applyWrites = Effect.fn("Sync.applyWrites")(function* (userId, mutations) { /* … */ }, Effect.catchTag("SqlError", Effect.die));
    return Sync.of({ applyWrites });
  }),
);
```

A long-running worker (the watchdog) is forked into its layer's scope with `Effect.forkScoped`, so shutdown stops it.

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

**Postgres (`@effect/sql-pg`).** A statement is an Effect: ``yield* sql`select …` ``. `sql.withTransaction(effect)` runs the effect in one transaction, on one connection; a failure, a defect or an interruption rolls it back. Identifiers are `sql(table)`, lists `sql.in(ids)`, jsonb `sql.json(value)`. `rowCount(statement)` (`db.ts`) reads how many rows a statement touched; `theRow` takes the one row an aggregate returns. `count(*)` is `int8` and arrives as a `bigint`: cast it (`count(*)::int`). `numeric` arrives as text.

```ts
const { started, ...result } = yield* sql.withTransaction(
  Effect.gen(function* () {
    const user = yield* sql`select id from "user" where id = ${userId} for share`;
    if (!user.length) return yield* refuse({ error: "sign_in_required" }); // rolls back
    rows += yield* rowCount(sql`insert into review … on conflict (id) do nothing`);
    // …
  }),
);
```

A database failure while answering a request is an outage or a bug: the service turns `SqlError` into a defect (`Effect.catchTag("SqlError", Effect.die)`), which the edge answers with `500 internal_error` and a Sentry report. A refusal stays a typed `ApiError`.

**Acquire, use, release.** Something taken that must be given back, whatever happens, is `Effect.acquireUseRelease`. AI credits: reserve them, call the model, refund what the answer did not use.

```ts
Effect.acquireUseRelease(
  reserve(userId, cost, at),
  () => Effect.andThen(rateLimit(userId), task),
  (_, exit) => refund(userId, cost - (Exit.isSuccess(exit) ? Math.min(cost, exit.value.items) : 0), at),
);
```

## Rules that are easy to miss

- **No AsyncLocalStorage in Effect code.** Fibers do not keep it, and the scheduler can run several requests' fibers in one callback. The request's facts live in `RequestContext` (`request.ts`), passed through Effect. The edge reads Sentry's scopes and root span once, when the request comes in, and passes them on.
- **Every Sentry span gets its parent explicitly.** Sentry finds the "active span" in AsyncLocalStorage, and a fiber that waited for a pooled connection or a semaphore resumes in the callback of the fiber that released it: another request's. So a span around an Effect is `sentrySpan(options, effect)`, and Promise code that Sentry traces (the model's SDK, the shape proxy's fetch) runs in `inSentryScope(ctx, …)`, which sets the request's scopes and root span. `server/test/leak.test.ts` fails if a span finds its parent by itself.
- **Better Auth is the one Promise caller of ours.** `inBetterAuth()` in `request.ts` sets the request (for `event()` and `log` in its hooks) in a small AsyncLocalStorage bridge at the start of each call. Nothing else uses the bridge.
- **A request runs to its end.** Bun's server interrupts a request's fiber when the client goes away. A write, an AI call, an account deletion or a sign-in that merges accounts must still finish. Effect's `HttpEffect.toHandled` makes the whole request fiber uninterruptible from its start, so the edge, Better Auth and static files are safe. `HttpRouter` makes each route interruptible again, so every route sets `uninterruptible: true`. Never wrap the edge or a route in `Effect.interruptible` or `Effect.timeout`. `server/test/disconnect.test.ts` checks this.
- **Logs:** `Effect.logInfo("request").pipe(Effect.annotateLogs({ … }))` writes the same JSON line as before. The request's fields come from `RequestContext`. Never put emails, codes or request bodies in a log.
