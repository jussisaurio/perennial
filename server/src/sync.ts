// Sync: reads stream from Electric through an auth proxy (each learner sees
// only their own rows); writes come in as batches of mutations, are checked,
// scoped to the session's user, and applied in one transaction. The response
// carries the Postgres transaction id, which the client waits to see in the
// stream before dropping its optimistic state, and whether any row changed (if
// none did, no echo will come: the client must not wait for one).

import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client";
import { PgClient } from "@effect/sql-pg";
import { Clock, Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/sql/SqlError";
import { NO_LEFT, type GardenLeft, type Mutation, type UserId, type WordId, type WriteResult } from "perennial-contract";
import { AppConfig } from "./config";
import { COURSE_DEFAULTS } from "./course";
import { rowCount, theRow } from "./db";
import { leftProblem, mergeLeft } from "./garden";
import { type ApiError, refuse } from "./http";
import { event, inSentryScope, RequestContext } from "./request";
import { Words } from "./words";

/** Tables a learner can read, each scoped to their user id. */
export const LEARNER_TABLES = ["course", "review", "word_state", "user_word", "user_sentence"];

const DAY = 86_400_000;
/** A device clock can be wrong: never accept times from the future (with a little slack). */
const clamp = (d: Date, now: Date) => (d.getTime() > now.getTime() ? now : d);

/**
 * Per-learner storage limits: far above real use (a 2000-word course with
 * every word added from texts), low enough that one account can't fill the
 * database.
 */
export const QUOTA = { user_word: 5_000, user_sentence: 25_000, word_state: 50_000, reviewsPerDay: 5_000 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class Sync extends Context.Service<
  Sync,
  {
    /** Applies a batch for the learner, in one transaction. */
    readonly applyWrites: (userId: UserId, mutations: readonly Mutation[]) => Effect.Effect<WriteResult, ApiError, RequestContext>;
    /**
     * Refuse (429 quota) when `n` more rows would not fit. The AI routes ask before they
     * call the model: their words are charged before the app writes them.
     */
    readonly ensureRoom: (userId: UserId, table: "user_word" | "user_sentence", n: number) => Effect.Effect<void, ApiError>;
    /** The learner's rows of one table, streamed from Electric. */
    readonly proxyShape: (req: Request, userId: UserId) => Effect.Effect<Response, ApiError, RequestContext>;
  }
>()("perennial/Sync") {}

export const SyncLive = Layer.effect(
  Sync,
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient;
    const words = yield* Words;
    const config = yield* AppConfig;

    // A database failure while answering a request is an outage or a bug, never
    // the learner's doing: a defect (500, with a Sentry report), as before.
    const ensureRoom = Effect.fn("Sync.ensureRoom")(
      function* (userId: UserId, table: "user_word" | "user_sentence", n: number) {
        const { count } = yield* theRow(sql<{ count: number }>`select count(*)::int as count from ${sql(table)} where user_id = ${userId}`);
        if (count + n > QUOTA[table]) return yield* refuse({ error: "quota", table, limit: QUOTA[table] });
      },
      Effect.catchTag("SqlError", Effect.die),
    );

    /** How many of `ids` are not in the table yet (only those take room). The ids are the rows' keys: a key that exists, whoever's row it is, adds no row. */
    const newRows = Effect.fnUntraced(function* (ids: ReadonlySet<string>, existing: (ids: string[]) => Effect.Effect<ReadonlyArray<object>, SqlError>) {
      return ids.size ? ids.size - (yield* existing([...ids])).length : 0;
    });

    /**
     * Refuse a batch that would take a table past its quota. Only rows that do
     * not exist yet count: a resent batch (its answer was lost) or an edit adds
     * none, so it is never refused at a quota (#292).
     */
    const checkQuota = Effect.fnUntraced(function* (userId: UserId, mutations: readonly Mutation[]) {
      const ids = { user_word: new Set<string>(), user_sentence: new Set<string>(), word_state: new Set<string>(), review: new Set<string>() };
      for (const m of mutations) {
        if (m.type === "user_word.upsert") ids.user_word.add(m.row.id);
        else if (m.type === "user_sentence.insert") ids.user_sentence.add(m.row.id);
        else if (m.type === "word_state.upsert") ids.word_state.add(m.row.word_id);
        else if (m.type === "review.insert") ids.review.add(m.row.id);
      }
      const adds = {
        user_word: yield* newRows(ids.user_word, (list) => sql`select 1 from user_word where id in ${sql.in(list)}`),
        user_sentence: yield* newRows(ids.user_sentence, (list) => sql`select 1 from user_sentence where id in ${sql.in(list)}`),
        word_state: yield* newRows(ids.word_state, (list) => sql`select 1 from word_state where user_id = ${userId} and word_id in ${sql.in(list)}`),
        review: yield* newRows(ids.review, (list) => sql`select 1 from review where id in ${sql.in(list)}`),
      };
      if (adds.user_word) yield* ensureRoom(userId, "user_word", adds.user_word);
      if (adds.user_sentence) yield* ensureRoom(userId, "user_sentence", adds.user_sentence);
      if (adds.word_state) {
        const { n } = yield* theRow(sql<{ n: number }>`select count(*)::int as n from word_state where user_id = ${userId}`);
        if (n + adds.word_state > QUOTA.word_state) return yield* refuse({ error: "quota", table: "word_state", limit: QUOTA.word_state });
      }
      if (adds.review) {
        const { n } = yield* theRow(sql<{ n: number }>`select count(*)::int as n from review where user_id = ${userId} and received_at > now() - interval '1 day'`);
        if (n + adds.review > QUOTA.reviewsPerDay) return yield* refuse({ error: "quota", table: "reviewsPerDay", limit: QUOTA.reviewsPerDay });
      }
    });

    /**
     * "Never show me this" for a form in your own text (Add screen): word_state
     * `form:<lang>:<form>`, only ever ignored, never studied or counted.
     */
    const ignoredForm = (id: string, status: string) => {
      const lang = /^form:([a-z]{2}):(.{1,60})$/u.exec(id)?.[1];
      return lang !== undefined && status === "ignored" && words.hasDeck(lang);
    };

    /**
     * Every word a review, word state or sentence points at must exist: a deck word
     * (in the review's language) or one of this learner's own words, saved before
     * or in this batch. Otherwise the whole batch is refused (422 unknown_word).
     */
    const checkWords = Effect.fnUntraced(function* (userId: UserId, mutations: readonly Mutation[]) {
      const own = new Set<string>(mutations.flatMap((m) => (m.type === "user_word.upsert" ? [m.row.id] : [])));
      const refs: { id: WordId; lang?: string }[] = [];
      for (const m of mutations) {
        if (m.type === "review.insert") refs.push({ id: m.row.word_id, lang: m.row.lang });
        else if (m.type === "word_state.upsert" && !ignoredForm(m.row.word_id, m.row.status)) refs.push({ id: m.row.word_id });
        else if (m.type === "user_sentence.insert") refs.push({ id: m.row.word_id });
      }
      const unknown = refs.filter((r) => !own.has(r.id) && !words.isDeckWord(r.id, r.lang)).map((r) => r.id);
      if (!unknown.length) return;
      const candidates = [...new Set(unknown)].filter((id) => UUID.test(id));
      const found = candidates.length ? new Set((yield* sql<{ id: string }>`select id from user_word where user_id = ${userId} and id in ${sql.in(candidates)}`).map((r) => r.id)) : new Set<string>();
      const missing = unknown.find((id) => !found.has(id));
      if (missing) return yield* refuse({ error: "unknown_word", word_id: missing.slice(0, 120) });
    });

    /**
     * Applies a batch in one transaction. `changed` is false when no statement
     * touched a row (a retried insert, an older state, a delete of nothing): no
     * change reaches the stream, so there is no txid echo to wait for.
     */
    const applyWrites = Effect.fn("Sync.applyWrites")(
      function* (userId: UserId, mutations: readonly Mutation[]) {
        const now = new Date(yield* Clock.currentTimeMillis);
        for (const m of mutations) if (m.type === "review.insert" && m.row.reviewed_at.getTime() > now.getTime() + DAY) return yield* refuse({ error: "review_from_the_future" });
        const { started, ...result } = yield* sql.withTransaction(
          Effect.gen(function* () {
            // Linking an anonymous learner (auth.ts mergeUsers) locks this row and ends
            // the anonymous sessions. A write racing it waits here, then finds no
            // session and is refused, instead of adding rows that the anonymous user's
            // deletion would take with it. A write that got here first is moved over.
            const user = yield* sql`select id from "user" where id = ${userId} for share`;
            if (!user.length || !(yield* sql`select 1 from session where "userId" = ${userId} limit 1`).length) return yield* refuse({ error: "sign_in_required" });
            yield* checkQuota(userId, mutations);
            yield* checkWords(userId, mutations);
            // The txid must be read inside the writing transaction.
            const { txid } = yield* theRow(sql<{ txid: string }>`select pg_current_xact_id()::xid::text as txid`);
            let rows = 0;
            const started: string[] = [];
            for (const m of mutations) {
              switch (m.type) {
                case "review.insert": {
                  const r = m.row;
                  // Insert-only: a reused id never overwrites anything, least of all another user's row.
                  rows += yield* rowCount(sql`insert into review (id, user_id, lang, word_id, skill, grade, kind, reviewed_at, duration_ms, sentence_id)
                    values (${r.id}, ${userId}, ${r.lang}, ${r.word_id}, ${r.skill}, ${r.grade}, ${r.kind}, ${clamp(r.reviewed_at, now)}, ${r.duration_ms}, ${r.sentence_id ?? null})
                    on conflict (id) do nothing`);
                  break;
                }
                case "review.delete":
                  rows += yield* rowCount(sql`delete from review where id = ${m.id} and user_id = ${userId}`);
                  break;
                case "course.upsert": {
                  const r = m.row;
                  // Leave it out (#351): merged with what is stored, under the row's lock, so it only moves forward.
                  let left: GardenLeft | null = null;
                  if (r.garden_left) {
                    const issue = leftProblem(r.garden_left, now.getTime());
                    if (issue === "clock") return yield* refuse({ error: "garden_from_the_future" });
                    if (issue) return yield* refuse({ error: "bad_request", issues: [issue] });
                    const stored = yield* sql<{ garden_left: GardenLeft }>`select garden_left from course where user_id = ${userId} and lang = ${r.lang} for update`;
                    // No row yet: a new course, with nothing left before this.
                    left = mergeLeft(stored[0]?.garden_left ?? NO_LEFT, r.garden_left);
                  }
                  // Only the columns sent change, so two devices editing different settings both win.
                  // The door only ever opens: a device that still has it closed never shuts it again.
                  const res = yield* sql<{ inserted: boolean }>`insert into course (user_id, lang, minutes, retention, door_open, garden_left)
                    values (${userId}, ${r.lang}, ${r.minutes ?? COURSE_DEFAULTS.minutes}, ${r.retention ?? COURSE_DEFAULTS.retention}, ${r.door_open === true}, ${sql.json(left ?? NO_LEFT)})
                    on conflict (user_id, lang) do update set
                      minutes = coalesce(${r.minutes ?? null}::smallint, course.minutes),
                      retention = coalesce(${r.retention ?? null}::real, course.retention),
                      door_open = course.door_open or excluded.door_open,
                      garden_left = ${left ? sql`excluded.garden_left` : sql`course.garden_left`}
                    returning (xmax = 0) as inserted`;
                  rows += res.length;
                  // xmax = 0: a new row, not an update. A new course is a learner starting a language.
                  if (res[0]?.inserted) started.push(r.lang);
                  break;
                }
                case "word_state.upsert": {
                  const r = m.row;
                  const at = clamp(r.updated_at, now);
                  rows += yield* rowCount(sql`insert into word_state (user_id, word_id, status, queued_at, updated_at) values (${userId}, ${r.word_id}, ${r.status}, ${r.queued_at ?? null}, ${at})
                    on conflict (user_id, word_id) do update set status = excluded.status, queued_at = excluded.queued_at, updated_at = excluded.updated_at
                    where excluded.updated_at > word_state.updated_at`);
                  break;
                }
                case "word_state.delete":
                  rows += yield* rowCount(sql`delete from word_state where user_id = ${userId} and word_id = ${m.word_id} and updated_at <= ${clamp(m.updated_at, now)}`);
                  break;
                case "user_word.upsert": {
                  const r = m.row;
                  // forms is a jsonb list (sql.json), which the app reads as string[] from the stream.
                  rows += yield* rowCount(sql`insert into user_word (id, user_id, lang, lemma, gloss, pos, forms, notes, deck_id)
                    values (${r.id}, ${userId}, ${r.lang}, ${r.lemma}, ${r.gloss}, ${r.pos ?? null}, ${sql.json(r.forms)}, ${r.notes ?? null}, ${r.deck_id ?? null})
                    on conflict (id) do update set lemma = excluded.lemma, gloss = excluded.gloss, pos = excluded.pos, forms = excluded.forms, notes = excluded.notes, deck_id = excluded.deck_id
                    where user_word.user_id = ${userId}`);
                  break;
                }
                case "user_word.delete":
                  rows += yield* rowCount(sql`delete from user_sentence where word_id = ${m.id}::text and user_id = ${userId}`);
                  rows += yield* rowCount(sql`delete from user_word where id = ${m.id} and user_id = ${userId}`);
                  break;
                case "user_sentence.insert": {
                  const r = m.row;
                  rows += yield* rowCount(sql`insert into user_sentence (id, user_id, word_id, text, translation, cloze, origin, model)
                    values (${r.id}, ${userId}, ${r.word_id}, ${r.text}, ${r.translation}, ${r.cloze}, ${r.origin}, ${r.model ?? null})
                    on conflict (id) do nothing`);
                  break;
                }
                case "user_sentence.delete":
                  rows += yield* rowCount(sql`delete from user_sentence where id = ${m.id} and user_id = ${userId}`);
                  break;
              }
            }
            return { txid: Number(txid), changed: rows > 0, started };
          }),
        );
        if (started.length) yield* event({ courseStarted: started.join(",") });
        return result;
      },
      Effect.catchTag("SqlError", Effect.die),
    );

    const proxyShape = Effect.fn("Sync.proxyShape")(function* (req: Request, userId: UserId) {
      const ctx = yield* RequestContext;
      const url = new URL(req.url);
      const table = url.searchParams.get("table") ?? "";
      if (!LEARNER_TABLES.includes(table)) return yield* refuse({ error: "unknown_shape" });
      const origin = new URL(`${config.electric.url}/v1/shape`);
      for (const [k, v] of url.searchParams) if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(k)) origin.searchParams.set(k, v);
      // The shape definition is always ours, never the client's.
      origin.searchParams.set("table", table);
      origin.searchParams.set("where", "user_id = $1");
      origin.searchParams.set("params[1]", userId);
      if (config.electric.secret) origin.searchParams.set("secret", config.electric.secret);
      // The request's own signal: when the browser goes, the fetch to Electric stops too.
      const res = yield* Effect.tryPromise({ try: () => inSentryScope(ctx, () => fetch(origin, { signal: req.signal })), catch: (e) => e }).pipe(
        // The browser cancelled the long poll (navigation, a new shape): nothing to report. Anything else is a bug or an outage.
        Effect.catch((e) => (req.signal.aborted ? Effect.succeed(null) : Effect.die(e))),
      );
      if (!res) return new Response(null, { status: 499 });
      const headers = new Headers(res.headers);
      headers.delete("content-encoding"); // fetch already decompressed the body
      headers.delete("content-length");
      headers.delete("access-control-allow-origin");
      // Same URL, different user: never let a shared cache serve it to someone else.
      headers.set("vary", "cookie");
      headers.set("cache-control", (headers.get("cache-control") ?? "no-cache").replace(/\bpublic\b/, "private").replace(/,?\s*s-maxage=\d+/, ""));
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    });

    return Sync.of({ applyWrites, ensureRoom, proxyShape });
  }),
);
