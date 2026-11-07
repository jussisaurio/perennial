// The demo learner (#784): ?demo in the app (web/src/dev/boot.ts). A new
// anonymous learner asks once, with a size. The server makes the course and its
// made-up review history (web/src/dev/plan.ts, the app's own planner) and writes
// both in one transaction, so only the size and the clock cross the wire.
//
// Only an anonymous learner with no course yet: so each demo costs a new
// anonymous sign-in, which Better Auth allows 20 times an hour per IP, behind
// the bot check (auth.ts). That is the demo's per-IP limit. Housekeeping deletes
// anonymous learners nobody uses (housekeeping.ts); ?demo=off and a sign-in from
// the demo delete one at once (web/src/dev/demo.ts, web/src/data/auth.ts).

import { PgClient } from "@effect/sql-pg";
import { Clock, Context, Effect, Layer } from "effect";
import type { AuthUser, DemoIn } from "perennial-contract";
import { DAY_MS } from "../../web/src/core/day";
import { demoHistory } from "../../web/src/dev/plan";
import { COURSE_DEFAULTS } from "./course";
import { type ApiError, refuse } from "./http";
import { event, type RequestContext } from "./request";
import { Words } from "./words";

export class Demo extends Context.Service<Demo, { readonly seed: (user: AuthUser, input: DemoIn) => Effect.Effect<void, ApiError, RequestContext> }>()("perennial/Demo") {}

export const DemoLive = Layer.effect(
  Demo,
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    const words = yield* Words;

    const seed = Effect.fn("Demo.seed")(
      function* (user: AuthUser, { lang, size, now }: DemoIn) {
        if (!user.isAnonymous) return yield* refuse({ error: "demo_needs_new_learner" });
        // As for written reviews (sync.ts): a clock more than a day ahead is refused, and a review after the server's now is stored at now (below).
        if (now > (yield* Clock.currentTimeMillis) + DAY_MS) return yield* refuse({ error: "review_from_the_future" });
        const deck = words.liveWords(lang);
        const t0 = performance.now();
        const history = yield* Effect.try({
          // No size: every deck word.
          try: () => demoHistory(lang, deck, "known" in size ? size : { studied: size.studied ?? deck.length }, now),
          // The planner throws only when the deck has too few words to know `known` of them.
          catch: (e) => refuse({ error: "bad_request", issues: [{ path: ["size", "known"], message: e instanceof Error ? e.message : String(e) }] }),
        });
        const planMs = Math.round(performance.now() - t0);
        const { reviews } = history;
        yield* sql.withTransaction(
          Effect.gen(function* () {
            // As a write does (sync.ts): a sign-in that merges this learner locks the row
            // and ends its sessions. For update: two demo requests at once take turns.
            const row = yield* sql`select id from "user" where id = ${user.id} for update`;
            if (!row.length || !(yield* sql`select 1 from session where "userId" = ${user.id} limit 1`).length) return yield* refuse({ error: "sign_in_required" });
            // Once per learner: no demo on top of a course, a real one or an earlier demo.
            if ((yield* sql`select 1 from course where user_id = ${user.id} limit 1`).length) return yield* refuse({ error: "demo_needs_new_learner" });
            yield* sql`insert into course (user_id, lang, minutes, retention, notes_read)
              values (${user.id}, ${lang}, ${COURSE_DEFAULTS.minutes}, ${COURSE_DEFAULTS.retention}, ${sql.json(history.notesRead)})`;
            // One statement for every review, its columns as arrays: a row per parameter
            // set would pass Postgres's 65,535 parameters at about 7,000 reviews.
            yield* sql`insert into review (id, user_id, lang, word_id, skill, grade, kind, reviewed_at, duration_ms)
              select gen_random_uuid(), ${user.id}, ${lang}, r.word_id, 'read', r.grade, 'review', least(r.reviewed_at, now()), r.duration_ms
              from unnest(${reviews.map((r) => r.wordId)}::text[], ${reviews.map((r) => r.grade)}::smallint[],
                ${reviews.map((r) => new Date(r.ts).toISOString())}::timestamptz[], ${reviews.map((r) => r.ms)}::integer[]) as r(word_id, grade, reviewed_at, duration_ms)`;
          }),
        );
        yield* event({ demo: lang, demoReviews: reviews.length, demoPlanMs: planMs });
      },
      Effect.catchTag("SqlError", Effect.die),
    );

    return Demo.of({ seed });
  }),
);
