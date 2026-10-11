import { afterAll, expect, test } from "bun:test";
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
