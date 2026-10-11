// Sync: reads stream from Electric through an auth proxy (each learner sees
// only their own rows); writes come in as batches of mutations, are checked,
// scoped to the session's user, and applied in one transaction. The response
// carries the Postgres transaction id, which the client waits to see in the
// stream before dropping its optimistic state.

import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from "@electric-sql/client";
import type { SQL } from "bun";
import { z } from "zod";
import type { Config } from "./config";
import { HttpError, json } from "./http";

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
      lemma: z.string().trim().min(1).max(60),
      gloss: z.string().trim().min(1).max(120),
      pos: z.string().max(20).nullish(),
      forms: z.array(z.string().max(60)).max(40),
      notes: z.string().max(300).nullish(),
      deck_id: z.string().max(120).nullish(),
    }),
  }),
  z.object({ type: z.literal("user_word.delete"), id: z.uuid() }),
  z.object({
    type: z.literal("user_sentence.insert"),
    row: z.object({
      id: z.uuid(),
      word_id: wordId,
      text: z.string().trim().min(1).max(400),
      translation: z.string().trim().min(1).max(400),
      cloze: z.string().trim().min(1).max(60),
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

export async function applyWrites(sql: SQL, userId: string, mutations: Mutation[]): Promise<number> {
  const now = new Date();
  for (const m of mutations) if (m.type === "review.insert" && m.row.reviewed_at.getTime() > now.getTime() + DAY) throw new HttpError(422, "review_from_the_future");
  return sql.begin(async (tx) => {
    // The txid must be read inside the writing transaction.
    const [{ txid }] = await tx`select pg_current_xact_id()::xid::text as txid`;
    for (const m of mutations) {
      switch (m.type) {
        case "review.insert": {
          const r = m.row;
          // Insert-only: a reused id never overwrites anything, least of all another user's row.
          await tx`insert into review (id, user_id, lang, word_id, skill, grade, kind, reviewed_at, duration_ms, sentence_id)
            values (${r.id}, ${userId}, ${r.lang}, ${r.word_id}, ${r.skill}, ${r.grade}, ${r.kind}, ${clamp(r.reviewed_at, now)}, ${r.duration_ms}, ${r.sentence_id ?? null})
            on conflict (id) do nothing`;
          break;
        }
        case "review.delete":
          await tx`delete from review where id = ${m.id} and user_id = ${userId}`;
          break;
        case "course.upsert": {
          const r = m.row;
          // Only the columns sent change, so two devices editing different settings both win.
          await tx`insert into course (user_id, lang, minutes, retention) values (${userId}, ${r.lang}, ${r.minutes ?? 7}, ${r.retention ?? 0.9})
            on conflict (user_id, lang) do update set
              minutes = coalesce(${r.minutes ?? null}::smallint, course.minutes),
              retention = coalesce(${r.retention ?? null}::real, course.retention)`;
          break;
        }
        case "word_state.upsert": {
          const r = m.row;
          const at = clamp(r.updated_at, now);
          await tx`insert into word_state (user_id, word_id, status, queued_at, updated_at) values (${userId}, ${r.word_id}, ${r.status}, ${r.queued_at ?? null}, ${at})
            on conflict (user_id, word_id) do update set status = excluded.status, queued_at = excluded.queued_at, updated_at = excluded.updated_at
            where excluded.updated_at > word_state.updated_at`;
          break;
        }
        case "word_state.delete":
          await tx`delete from word_state where user_id = ${userId} and word_id = ${m.word_id} and updated_at <= ${clamp(m.updated_at, now)}`;
          break;
        case "user_word.upsert": {
          const r = m.row;
          await tx`insert into user_word (id, user_id, lang, lemma, gloss, pos, forms, notes, deck_id)
            values (${r.id}, ${userId}, ${r.lang}, ${r.lemma}, ${r.gloss}, ${r.pos ?? null}, ${JSON.stringify(r.forms)}::jsonb, ${r.notes ?? null}, ${r.deck_id ?? null})
            on conflict (id) do update set lemma = excluded.lemma, gloss = excluded.gloss, pos = excluded.pos, forms = excluded.forms, notes = excluded.notes, deck_id = excluded.deck_id
            where user_word.user_id = ${userId}`;
          break;
        }
        case "user_word.delete":
          await tx`delete from user_sentence where word_id = ${m.id}::text and user_id = ${userId}`;
          await tx`delete from user_word where id = ${m.id} and user_id = ${userId}`;
          break;
        case "user_sentence.insert": {
          const r = m.row;
          await tx`insert into user_sentence (id, user_id, word_id, text, translation, cloze, origin, model)
            values (${r.id}, ${userId}, ${r.word_id}, ${r.text}, ${r.translation}, ${r.cloze}, ${r.origin}, ${r.model ?? null})
            on conflict (id) do nothing`;
          break;
        }
        case "user_sentence.delete":
          await tx`delete from user_sentence where id = ${m.id} and user_id = ${userId}`;
          break;
      }
    }
    return Number(txid);
  });
}

export async function handleWrite(req: Request, sql: SQL, userId: string): Promise<Response> {
  const body = WriteBatch.safeParse(await req.json().catch(() => null));
  if (!body.success) throw new HttpError(422, "bad_request", { issues: body.error.issues.slice(0, 5) });
  return json({ txid: await applyWrites(sql, userId, body.data.mutations) });
}
