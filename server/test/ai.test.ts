import { afterAll, expect, test } from "bun:test";
import { QUOTA } from "../src/sync";
import { startApp, stopMockLLM, unique } from "./helpers";

const t = await startApp();
afterAll(async () => (await t.stop(), stopMockLLM()));

const item = (f: string) => ({ form: f, sentence: `Veo un ${f} aquí.` });

test("words from your own text spend AI words until they run out", async () => {
  const cookie = await t.signIn(unique("miner"));
  const r = await t.call("/api/ai/mine", { lang: "es", items: [item("zorro"), item("búho")], known: ["ver"] }, cookie);
  expect(r.status).toBe(200);
  expect(r.body.words[0].examples[0].text).toBe("Veo un zorro aquí."); // the learner's own sentence is kept
  expect(r.body.credits).toMatchObject({ used: 2, left: 23 });

  const many = Array.from({ length: 15 }, (_, i) => item(`w${i}`));
  await t.call("/api/ai/mine", { lang: "es", items: many, known: [] }, cookie);
  const out = await t.call("/api/ai/mine", { lang: "es", items: many, known: [] }, cookie);
  expect(out.status).toBe(402);
  expect(out.body).toMatchObject({ error: "out_of_credits", left: 8, needed: 15 });
});

test("every model call is logged with its cost and prompt version", async () => {
  const cookie = await t.signIn(unique("logged"));
  const id = (await t.me(cookie)).id;
  await t.call("/api/ai/examples", { lang: "de", words: [{ lemma: "Haus", gloss: "house", seen: [] }], known: [] }, cookie);
  const [row] = await t.sql`select task, model, prompt_version, ok, usd from ai_request where user_id = ${id}`;
  expect(row).toMatchObject({ task: "examples", model: "claude-haiku-4-5", ok: true });
  expect(row.prompt_version).toBeTruthy();
  expect(Number(row.usd)).toBeGreaterThan(0);
});

test("AI needs an account: anonymous learners and bad input are refused before any model call", async () => {
  const anon = await t.anonymous();
  expect((await t.call("/api/ai/mine", { lang: "es", items: [item("x")], known: [] }, anon)).status).toBe(403);
  const cookie = await t.signIn(unique("bad"));
  const before = await t.app.ai.spentThisMonth();
  expect((await t.call("/api/ai/mine", { lang: "fr", items: [item("le")], known: [] }, cookie)).status).toBe(422);
  expect(await t.app.ai.spentThisMonth()).toBe(before);
});

test("past the monthly budget, AI pauses for everyone and says until when", async () => {
  const tight = await startApp({ monthlyBudgetUsd: 0 });
  const cookie = await tight.signIn(unique("paused"));
  const r = await tight.call("/api/ai/mine", { lang: "es", items: [item("lobo")], known: [] }, cookie);
  expect(r.status).toBe(503);
  expect(r.body.error).toBe("paused");
  expect(r.body.until).toMatch(/^\d{4}-\d{2}-01$/);
  expect((await tight.me(cookie)).credits.used).toBe(0); // nothing charged
  await tight.stop();
});

test("parallel requests can't spend more than the allowance", async () => {
  const cookie = await t.signIn(unique("burst"));
  // 25 credits, 6 requests of 5 words at once: at most 5 can be granted.
  const batch = (n: number) => Array.from({ length: 5 }, (_, i) => item(`p${n}x${i}`));
  const all = await Promise.all(Array.from({ length: 6 }, (_, n) => t.call("/api/ai/mine", { lang: "es", items: batch(n), known: [] }, cookie)));
  const granted = all.filter((r) => r.status === 200).reduce((sum, r) => sum + r.body.words.length, 0);
  expect(granted).toBeLessThanOrEqual(25);
  expect(all.filter((r) => r.status === 402).length).toBeGreaterThanOrEqual(1);
  expect((await t.me(cookie)).credits.used).toBe(granted);
});

test("AI output is held to the /api/write limits: long notes are cut, words that can't fit are dropped and not charged", async () => {
  const cookie = await t.signIn(unique("long"));
  const r = await t.call("/api/ai/mine", { lang: "es", items: [item("longnote"), item("longgloss"), item("gato")], known: [] }, cookie);
  expect(r.status).toBe(200);
  expect(r.body.words.map((w: { lemma: string }) => w.lemma)).toEqual(["longnote", "gato"]);
  expect(r.body.words[0].notes.length).toBeLessThanOrEqual(300);
  expect(r.body.credits.used).toBe(2);
  // What came back is accepted by /api/write.
  const w = r.body.words[0];
  const saved = await t.write(cookie, [{ type: "user_word.upsert", row: { id: crypto.randomUUID(), lang: "es", lemma: w.lemma, gloss: w.gloss, pos: w.pos, forms: w.forms, notes: w.notes } }]);
  expect(saved.status).toBe(200);
});

test("a failed model call gives the credits back", async () => {
  const broken = await startApp({ anthropic: { apiKey: "test-key", baseURL: "http://localhost:1", model: "claude-haiku-4-5" } });
  const cookie = await broken.signIn(unique("refund"));
  const r = await broken.call("/api/ai/mine", { lang: "es", items: [item("lobo")], known: [] }, cookie);
  expect(r.status).toBe(502);
  expect((await broken.me(cookie)).credits.used).toBe(0);
  await broken.stop();
});

// #174: AI words are charged before the app writes them. Words that could not be
// saved (the learner is at their own-words limit) are refused first: nothing charged.
test("at the own-words limit, AI is refused before any model call and nothing is charged", async () => {
  const cookie = await t.signIn(unique("full"));
  const id = (await t.me(cookie)).id;
  await t.sql`insert into user_word (id, user_id, lang, lemma, gloss, forms)
    select gen_random_uuid(), ${id}, 'es', 'w' || n, 'g', '[]'::jsonb from generate_series(1, ${QUOTA.user_word - 1}) n`;
  const r = await t.call("/api/ai/mine", { lang: "es", items: [item("zorro"), item("búho")], known: [] }, cookie);
  expect(r.status).toBe(429);
  expect(r.body).toMatchObject({ error: "quota", table: "user_word" });
  expect((await t.me(cookie)).credits.used).toBe(0);
  expect((await t.sql`select 1 from ai_request where user_id = ${id}`).length).toBe(0);
  // One more still fits.
  expect((await t.call("/api/ai/mine", { lang: "es", items: [item("zorro")], known: [] }, cookie)).status).toBe(200);
});
