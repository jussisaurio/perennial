// Security: nobody can read or change another learner's data, state changes
// only come from our own page, and production refuses unsafe configuration.

import { afterAll, describe, expect, test } from "bun:test";
import { configProblems, loadConfig } from "../src/config";
import { QUOTA } from "../src/sync";
import { review, startApp, stopMockLLM, unique } from "./helpers";

const t = await startApp();
afterAll(async () => (await t.stop(), stopMockLLM()));

/** Alice has one row in every table; Mallory (and strangers) try to reach them. */
async function aliceWithData() {
  const alice = await t.signIn(unique("alice"));
  const aliceId = (await t.me(alice)).id;
  const r = review("es.w.aaaaaaaaaa");
  const wordId = crypto.randomUUID();
  const sentenceId = crypto.randomUUID();
  await t.write(alice, [
    r,
    { type: "course.upsert", row: { lang: "es", minutes: 9 } },
    { type: "word_state.upsert", row: { word_id: "es.w.bbbbbbbbbb", status: "paused", updated_at: new Date().toISOString() } },
    { type: "user_word.upsert", row: { id: wordId, lang: "es", lemma: "zorro", gloss: "fox", forms: ["zorro"] } },
    { type: "user_sentence.insert", row: { id: sentenceId, word_id: wordId, text: "Veo un zorro.", translation: "I see a fox.", cloze: "zorro", origin: "own-text" } },
  ]);
  return { alice, aliceId, reviewId: r.row.id, wordId, sentenceId };
}

const TABLES = ["course", "review", "word_state", "user_word", "user_sentence"];
const count = async (table: string, userId: string) => Number((await t.sql`select count(*)::int as n from ${t.sql(table)} where user_id = ${userId}`)[0].n);

describe("reads: shapes only ever contain your own rows", () => {
  test.each(TABLES)("%s", async (table) => {
    const { aliceId } = await aliceWithData();
    const mallory = await t.signIn(unique("mallory"));
    // Every way a client might try to widen the shape.
    for (const extra of ["", "&where=true", `&where=user_id%3D'${aliceId}'`, `&params[1]=${aliceId}`, "&columns=user_id", `&subset__where=user_id%3D'${aliceId}'`]) {
      const res = await t.call(`/api/shape?table=${table}&offset=-1${extra}`, undefined, mallory);
      if (res.status !== 200) continue; // rejected outright is fine too
      // A log is an array of messages; a subset request returns { data: [...] }.
      const msgs = (Array.isArray(res.body) ? res.body : res.body.data) as { value?: { user_id: string } }[];
      const ids = msgs.filter((m) => m.value).map((m) => m.value!.user_id);
      expect(ids).not.toContain(aliceId);
    }
    expect((await t.call(`/api/shape?table=${table}&offset=-1`)).status).toBe(401);
  });

  test("tables outside the allow-list are refused", async () => {
    const mallory = await t.signIn(unique("mallory"));
    for (const table of ["user", "session", "account", "verification", "ai_usage", "ai_request", "public.user"]) {
      expect((await t.call(`/api/shape?table=${table}&offset=-1`, undefined, mallory)).status).toBe(400);
    }
  });
});

describe("writes: every mutation is scoped to the session's user", () => {
  test("another user's ids can't be overwritten or deleted", async () => {
    const { aliceId, reviewId, wordId, sentenceId } = await aliceWithData();
    const before = Object.fromEntries(await Promise.all(TABLES.map(async (tb) => [tb, await count(tb, aliceId)])));
    const mallory = await t.signIn(unique("mallory"));
    const res = await t.write(mallory, [
      { type: "review.insert", row: { ...review("x").row, id: reviewId, grade: 1 } },
      { type: "review.delete", id: reviewId },
      { type: "user_word.upsert", row: { id: wordId, lang: "es", lemma: "hacked", gloss: "hacked", forms: [] } },
      { type: "user_word.delete", id: wordId },
      { type: "user_sentence.insert", row: { id: sentenceId, word_id: wordId, text: "x y", translation: "x", cloze: "x", origin: "ai" } },
      { type: "user_sentence.delete", id: sentenceId },
      { type: "word_state.delete", word_id: "es.w.bbbbbbbbbb", updated_at: new Date().toISOString() },
    ]);
    expect(res.status).toBe(200); // accepted, but none of it touches Alice
    const after = Object.fromEntries(await Promise.all(TABLES.map(async (tb) => [tb, await count(tb, aliceId)])));
    expect(after).toEqual(before);
    const [w] = await t.sql`select lemma, user_id from user_word where id = ${wordId}`;
    expect(w).toMatchObject({ lemma: "zorro", user_id: aliceId });
    const [r] = await t.sql`select grade from review where id = ${reviewId}`;
    expect(r.grade).toBe(3);
  });

  test("a client can't choose whose row it writes", async () => {
    const mallory = await t.signIn(unique("mallory"));
    const malloryId = (await t.me(mallory)).id;
    const { aliceId } = await aliceWithData();
    const r = review("es.w.cccccccccc");
    await t.write(mallory, [{ ...r, row: { ...r.row, user_id: aliceId } }]);
    const [row] = await t.sql`select user_id from review where id = ${r.row.id}`;
    expect(row.user_id).toBe(malloryId);
  });

  test("no session, no writes", async () => {
    expect((await t.call("/api/write", { mutations: [review("x")] })).status).toBe(401);
  });
});

describe("accounts and AI", () => {
  test("deleting your account deletes only yours", async () => {
    const { aliceId } = await aliceWithData();
    const mallory = await t.signIn(unique("mallory"));
    expect((await t.call("/api/account/delete", {}, mallory)).status).toBe(200);
    expect(await count("review", aliceId)).toBe(1);
  });

  test("AI and account routes need a session; AI needs a real account", async () => {
    expect((await t.call("/api/me")).status).toBe(401);
    expect((await t.call("/api/account/delete", {})).status).toBe(401);
    expect((await t.call("/api/ai/mine", { lang: "es", items: [{ form: "x", sentence: "x" }], known: [] })).status).toBe(401);
    const anon = await t.anonymous();
    expect((await t.call("/api/ai/examples", { lang: "es", words: [{ lemma: "x", gloss: "x", seen: [] }], known: [] }, anon)).status).toBe(403);
  });
});

describe("state changes only from our own page", () => {
  test("cross-origin and non-JSON posts are refused", async () => {
    const cookie = await t.signIn(unique("csrf"));
    const body = { mutations: [review("es.w.dddddddddd")] };
    expect((await t.call("/api/write", body, cookie, { origin: "https://evil.example" })).status).toBe(403);
    expect((await t.call("/api/account/delete", {}, cookie, { origin: "https://evil.example" })).status).toBe(403);
    // No Origin, but the browser says it's another site.
    const res = await fetch(`${t.url}/api/write`, { method: "POST", headers: { cookie, "content-type": "application/json", "sec-fetch-site": "cross-site" }, body: JSON.stringify(body) });
    expect(res.status).toBe(403);
    // A plain HTML form post (no JSON) is refused even from our origin.
    const form = await fetch(`${t.url}/api/account/delete`, { method: "POST", headers: { cookie, origin: t.config.appUrl, "content-type": "application/x-www-form-urlencoded" }, body: "a=1" });
    expect(form.status).toBe(415);
    expect((await t.me(cookie)).id).toBeTruthy(); // still there
  });
});

describe("limits", () => {
  test("oversized bodies are refused before parsing", async () => {
    const cookie = await t.signIn(unique("big"));
    const huge = { mutations: [{ type: "user_sentence.insert", row: { text: "x".repeat(600 * 1024) } }] };
    expect((await t.call("/api/write", huge, cookie)).status).toBe(413);
  });

  test("per-learner storage quotas", async () => {
    const cookie = await t.signIn(unique("quota"));
    const saved = QUOTA.user_word;
    QUOTA.user_word = 2;
    try {
      const word = () => ({ type: "user_word.upsert", row: { id: crypto.randomUUID(), lang: "es", lemma: "x", gloss: "x", forms: [] } });
      expect((await t.write(cookie, [word(), word()])).status).toBe(200);
      const over = await t.write(cookie, [word()]);
      expect(over.status).toBe(429);
      expect(over.body).toMatchObject({ error: "quota", table: "user_word" });
    } finally {
      QUOTA.user_word = saved;
    }
  });
});

describe("production configuration fails closed", () => {
  const prod = (env: Record<string, string | undefined>) => {
    const all = { NODE_ENV: "production", ...env };
    const saved = Object.fromEntries(Object.keys(all).map((k) => [k, process.env[k]]));
    const set = (vals: Record<string, string | undefined>) => {
      for (const [k, v] of Object.entries(vals)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    };
    set(all);
    try {
      return loadConfig();
    } finally {
      set(saved);
    }
  };
  const good = { BETTER_AUTH_SECRET: "x".repeat(40), RESEND_API_KEY: "re_test", MAIL_FROM: "Perennial <hello@example.com>", APP_URL: "https://perennial.example", DATABASE_URL: "postgres://x", ELECTRIC_SECRET: "s" };

  test("a complete production config is fine, and never dev mode", () => {
    const c = prod(good);
    expect(c.dev).toBe(false);
    expect(configProblems(c)).toEqual([]);
  });

  test("missing email key: still not dev mode (no open outbox), and refuses to start", () => {
    const c = prod({ ...good, RESEND_API_KEY: undefined, PERENNIAL_DEV: "1" });
    expect(c.dev).toBe(false);
    expect(configProblems(c).join()).toContain("RESEND_API_KEY");
  });

  test("default or short auth secret refuses to start", () => {
    expect(configProblems(prod({ ...good, BETTER_AUTH_SECRET: undefined })).join()).toContain("BETTER_AUTH_SECRET");
    expect(configProblems(prod({ ...good, BETTER_AUTH_SECRET: "short" })).join()).toContain("BETTER_AUTH_SECRET");
    expect(configProblems(prod({ ...good, APP_URL: "http://perennial.example" })).join()).toContain("APP_URL");
  });
});
