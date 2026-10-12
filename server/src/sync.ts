// Sync: reads stream from Electric through an auth proxy (each learner sees
// only their own rows); writes come in as batches of mutations, are checked,
// scoped to the session's user, and applied in one transaction. The response
// carries the Postgres transaction id, which the client waits to see in the
// stream before dropping its optimistic state, and whether any row changed (if
// none did, no echo will come: the client must not wait for one).

import { deckWords, isDeckWord } from "./words";
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client";
import type { SQL } from "bun";
import { z } from "zod";
import type { Config } from "./config";
import { HttpError, json, readJson } from "./http";

/** Tables a learner can read, each scoped to their user id. */
const SHAPES: Record<string, { where: string }> = {
  course: { where: "user_id = $1" },
  review: { where: "user_id = $1" },
  word_state: { where: "user_id = $1" },
  user_word: { where: "user_id = $1" },
  user_sentence: { where: "user_id = $1" },
};

export async function proxyShape(req: Request, userId: string, config: Config): Promise<Response> {
  const url = new URL(req.url);
  const table = url.searchParams.get("table") ?? "";
  const def = SHAPES[table];
  if (!def) throw new HttpError(400, "unknown_shape");
  const origin = new URL(`${config.electric.url}/v1/shape`);
  for (const [k, v] of url.searchParams) if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(k)) origin.searchParams.set(k, v);
  // The shape definition is always ours, never the client's.
  origin.searchParams.set("table", table);
  origin.searchParams.set("where", def.where);
  origin.searchParams.set("params[1]", userId);
  if (config.electric.secret) origin.searchParams.set("secret", config.electric.secret);
  let res: Response;
  try {
    res = await fetch(origin, { signal: req.signal });
  } catch (e) {
    // The browser cancelled the long poll (navigation, a new shape): nothing to report.
    if (req.signal.aborted) return new Response(null, { status: 499 });
    throw e;
  }
  const headers = new Headers(res.headers);
  headers.delete("content-encoding"); // fetch already decompressed the body
  headers.delete("content-length");
  headers.delete("access-control-allow-origin");
  // Same URL, different user: never let a shared cache serve it to someone else.
  headers.set("vary", "cookie");
  headers.set("cache-control", (headers.get("cache-control") ?? "no-cache").replace(/\bpublic\b/, "private").replace(/,?\s*s-maxage=\d+/, ""));
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// ---------- writes ----------

const DAY = 86_400_000;
/** Text limits for learner rows. Perennial AI output is held to the same ones (ai.ts). */
export const LIMITS = { lemma: 60, gloss: 120, pos: 20, form: 60, forms: 40, notes: 300, text: 400, translation: 400, cloze: 60 };
const lang = z.enum(["es", "de"]);
const wordId = z.string().min(1).max(120);
const ts = z.coerce.date();

const Mutation = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("review.insert"),
    row: z.object({
      id: z.uuid(),
      lang,
      word_id: wordId,
      skill: z.enum(["read", "listen", "write"]),
      grade: z.number().int().min(1).max(4),
      kind: z.enum(["review", "known"]).default("review"),
      reviewed_at: ts,
      duration_ms: z.number().int().min(0).max(3_600_000),
      sentence_id: z.string().max(120).nullish(),
    }),
  }),
  z.object({ type: z.literal("review.delete"), id: z.uuid() }), // Undo
  z.object({
    type: z.literal("course.upsert"),
    row: z.object({ lang, minutes: z.number().int().min(1).max(120).optional(), retention: z.number().min(0.7).max(0.99).optional() }),
  }),
  z.object({
    type: z.literal("word_state.upsert"),
    row: z.object({ word_id: wordId, status: z.enum(["queued", "paused", "ignored"]), queued_at: ts.nullish(), updated_at: ts }),
  }),
  z.object({ type: z.literal("word_state.delete"), word_id: wordId, updated_at: ts }),
  z.object({
    type: z.literal("user_word.upsert"),
    row: z.object({
      id: z.uuid(),
      lang,
      lemma: z.string().trim().min(1).max(LIMITS.lemma),
      gloss: z.string().trim().min(1).max(LIMITS.gloss),
      pos: z.string().max(LIMITS.pos).nullish(),
      forms: z.array(z.string().max(LIMITS.form)).max(LIMITS.forms),
      notes: z.string().max(LIMITS.notes).nullish(),
      deck_id: z.string().max(120).nullish(),
    }),
  }),
  z.object({ type: z.literal("user_word.delete"), id: z.uuid() }),
  z.object({
    type: z.literal("user_sentence.insert"),
    row: z.object({
      id: z.uuid(),
      word_id: wordId,
      text: z.string().trim().min(1).max(LIMITS.text),
      translation: z.string().trim().min(1).max(LIMITS.translation),
      cloze: z.string().trim().min(1).max(LIMITS.cloze),
      origin: z.enum(["own-text", "ai"]),
      model: z.string().max(80).nullish(),
    }),
  }),
  z.object({ type: z.literal("user_sentence.delete"), id: z.uuid() }),
]);
export const WriteBatch = z.object({ mutations: z.array(Mutation).min(1).max(500) });
export type Mutation = z.infer<typeof Mutation>;

/** A device clock can be wrong: never accept times from the future (with a little slack). */
const clamp = (d: Date, now: Date) => (d.getTime() > now.getTime() ? now : d);

/**
 * Per-learner storage limits: far above real use (a 2000-word course with
 * every word added from texts), low enough that one account can't fill the
 * database.
 */
export const QUOTA = { user_word: 5_000, user_sentence: 25_000, word_state: 50_000, reviewsPerDay: 5_000 };

async function checkQuota(tx: SQL, userId: string, mutations: Mutation[]) {
  const adds = { user_word: 0, user_sentence: 0, word_state: 0, review: 0 };
  for (const m of mutations) {
    if (m.type === "user_word.upsert") adds.user_word++;
    else if (m.type === "user_sentence.insert") adds.user_sentence++;
    else if (m.type === "word_state.upsert") adds.word_state++;
    else if (m.type === "review.insert") adds.review++;
  }
  const over = (table: keyof typeof QUOTA, n: number, limit: number) => {
    if (n > limit) throw new HttpError(429, "quota", { table, limit });
  };
  if (adds.user_word) over("user_word", Number((await tx`select count(*) as n from user_word where user_id = ${userId}`)[0].n) + adds.user_word, QUOTA.user_word);
  if (adds.user_sentence) over("user_sentence", Number((await tx`select count(*) as n from user_sentence where user_id = ${userId}`)[0].n) + adds.user_sentence, QUOTA.user_sentence);
  if (adds.word_state) over("word_state", Number((await tx`select count(*) as n from word_state where user_id = ${userId}`)[0].n) + adds.word_state, QUOTA.word_state);
  if (adds.review) over("reviewsPerDay", Number((await tx`select count(*) as n from review where user_id = ${userId} and received_at > now() - interval '1 day'`)[0].n) + adds.review, QUOTA.reviewsPerDay);
}

/**
 * "Never show me this" for a form in your own text (Add screen): word_state
 * `form:<lang>:<form>`, only ever ignored, never studied or counted.
 */
function ignoredForm(id: string, status: string): boolean {
  const m = /^form:([a-z]{2}):(.{1,60})$/u.exec(id);
  return !!m && status === "ignored" && deckWords().has(m[1]);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every word a review, word state or sentence points at must exist: a deck word
 * (in the review's language) or one of this learner's own words, saved before
 * or in this batch. Otherwise the whole batch is refused (422 unknown_word).
 */
async function checkWords(tx: SQL, userId: string, mutations: Mutation[]) {
  const own = new Set(mutations.flatMap((m) => (m.type === "user_word.upsert" ? [m.row.id] : [])));
  const refs: { id: string; lang?: string }[] = [];
  for (const m of mutations) {
    if (m.type === "review.insert") refs.push({ id: m.row.word_id, lang: m.row.lang });
    else if (m.type === "word_state.upsert" && !ignoredForm(m.row.word_id, m.row.status)) refs.push({ id: m.row.word_id });
    else if (m.type === "user_sentence.insert") refs.push({ id: m.row.word_id });
  }
  const unknown = refs.filter((r) => !own.has(r.id) && !isDeckWord(r.id, r.lang)).map((r) => r.id);
  if (!unknown.length) return;
  const candidates = [...new Set(unknown)].filter((id) => UUID.test(id));
  const found = candidates.length ? new Set((await tx`select id from user_word where user_id = ${userId} and id in ${tx(candidates)}`).map((r: { id: string }) => r.id)) : new Set<string>();
  const missing = unknown.find((id) => !found.has(id));
  if (missing) throw new HttpError(422, "unknown_word", { word_id: missing.slice(0, 120) });
}

/**
 * Applies a batch in one transaction. `changed` is false when no statement
 * touched a row (a retried insert, an older state, a delete of nothing): no
 * change reaches the stream, so there is no txid echo to wait for.
 */
export async function applyWrites(sql: SQL, userId: string, mutations: Mutation[]): Promise<{ txid: number; changed: boolean }> {
  const now = new Date();
  for (const m of mutations) if (m.type === "review.insert" && m.row.reviewed_at.getTime() > now.getTime() + DAY) throw new HttpError(422, "review_from_the_future");
  return sql.begin(async (tx) => {
    // Linking an anonymous learner (auth.ts mergeUsers) locks this row and ends
    // the anonymous sessions. A write racing it waits here, then finds no
    // session and is refused, instead of adding rows that the anonymous user's
    // deletion would take with it. A write that got here first is moved over.
    const [user] = await tx`select id from "user" where id = ${userId} for share`;
    if (!user || !(await tx`select 1 from session where "userId" = ${userId} limit 1`).length) throw new HttpError(401, "sign_in_required");
    await checkQuota(tx, userId, mutations);
    await checkWords(tx, userId, mutations);
    // The txid must be read inside the writing transaction.
    const [{ txid }] = await tx`select pg_current_xact_id()::xid::text as txid`;
    let rows = 0;
    const run = async (q: Promise<{ count: number }>) => void (rows += (await q).count);
    for (const m of mutations) {
      switch (m.type) {
        case "review.insert": {
          const r = m.row;
          // Insert-only: a reused id never overwrites anything, least of all another user's row.
          await run(tx`insert into review (id, user_id, lang, word_id, skill, grade, kind, reviewed_at, duration_ms, sentence_id)
            values (${r.id}, ${userId}, ${r.lang}, ${r.word_id}, ${r.skill}, ${r.grade}, ${r.kind}, ${clamp(r.reviewed_at, now)}, ${r.duration_ms}, ${r.sentence_id ?? null})
            on conflict (id) do nothing`);
          break;
        }
        case "review.delete":
          await run(tx`delete from review where id = ${m.id} and user_id = ${userId}`);
          break;
        case "course.upsert": {
          const r = m.row;
          // Only the columns sent change, so two devices editing different settings both win.
          await run(tx`insert into course (user_id, lang, minutes, retention) values (${userId}, ${r.lang}, ${r.minutes ?? 7}, ${r.retention ?? 0.9})
            on conflict (user_id, lang) do update set
              minutes = coalesce(${r.minutes ?? null}::smallint, course.minutes),
              retention = coalesce(${r.retention ?? null}::real, course.retention)`);
          break;
        }
        case "word_state.upsert": {
          const r = m.row;
          const at = clamp(r.updated_at, now);
          await run(tx`insert into word_state (user_id, word_id, status, queued_at, updated_at) values (${userId}, ${r.word_id}, ${r.status}, ${r.queued_at ?? null}, ${at})
            on conflict (user_id, word_id) do update set status = excluded.status, queued_at = excluded.queued_at, updated_at = excluded.updated_at
            where excluded.updated_at > word_state.updated_at`);
          break;
        }
        case "word_state.delete":
          await run(tx`delete from word_state where user_id = ${userId} and word_id = ${m.word_id} and updated_at <= ${clamp(m.updated_at, now)}`);
          break;
        case "user_word.upsert": {
          const r = m.row;
          await run(tx`insert into user_word (id, user_id, lang, lemma, gloss, pos, forms, notes, deck_id)
            values (${r.id}, ${userId}, ${r.lang}, ${r.lemma}, ${r.gloss}, ${r.pos ?? null}, ${JSON.stringify(r.forms)}::jsonb, ${r.notes ?? null}, ${r.deck_id ?? null})
            on conflict (id) do update set lemma = excluded.lemma, gloss = excluded.gloss, pos = excluded.pos, forms = excluded.forms, notes = excluded.notes, deck_id = excluded.deck_id
            where user_word.user_id = ${userId}`);
          break;
        }
        case "user_word.delete":
          await run(tx`delete from user_sentence where word_id = ${m.id}::text and user_id = ${userId}`);
          await run(tx`delete from user_word where id = ${m.id} and user_id = ${userId}`);
          break;
        case "user_sentence.insert": {
          const r = m.row;
          await run(tx`insert into user_sentence (id, user_id, word_id, text, translation, cloze, origin, model)
            values (${r.id}, ${userId}, ${r.word_id}, ${r.text}, ${r.translation}, ${r.cloze}, ${r.origin}, ${r.model ?? null})
            on conflict (id) do nothing`);
          break;
        }
        case "user_sentence.delete":
          await run(tx`delete from user_sentence where id = ${m.id} and user_id = ${userId}`);
          break;
      }
    }
    return { txid: Number(txid), changed: rows > 0 };
  });
}

export async function handleWrite(req: Request, sql: SQL, userId: string): Promise<Response> {
  const body = WriteBatch.safeParse(await readJson(req, 512 * 1024));
  if (!body.success) throw new HttpError(422, "bad_request", { issues: body.error.issues.slice(0, 5) });
  return json(await applyWrites(sql, userId, body.data.mutations));
}
