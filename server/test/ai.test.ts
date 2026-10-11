import { afterAll, expect, test } from "bun:test";
import { startApp, stopMockLLM } from "./helpers";

const t = await startApp();
const tight = await startApp({ monthlyBudgetUsd: 0.000001 });
afterAll(() => (t.stop(), tight.stop(), stopMockLLM()));

const batch = (cursor: number) => ({ lang: "es", language: "Spanish", native: "English", cursor, next: cursor + 3, forms: ["casa", "perro", "gato"].map((f) => `${f}${cursor}`) });

test("course batches are generated once and shared by every learner", async () => {
  const a = await t.signIn("a@example.com");
  const b = await t.signIn("b@example.com");
  const first = await t.call("/api/ai/course-batch", batch(0), a);
  expect(first.status).toBe(200);
  expect(first.body).toMatchObject({ cached: false, next: 3, model: "claude-haiku-4-5" });
  expect(first.body.words).toHaveLength(3);
  expect(first.body.words[0].examples.length).toBeGreaterThan(0);
  const spent = t.app.ai.spentThisMonth();
  expect(spent).toBeGreaterThan(0);

  const second = await t.call("/api/ai/course-batch", batch(0), b);
  expect(second.body.cached).toBe(true);
  expect(second.body.words).toEqual(first.body.words);
  expect(t.app.ai.spentThisMonth()).toBe(spent); // no new model call

  // Course batches don't spend personal credits.
  expect((await t.call("/api/me", undefined, a)).body.credits.used).toBe(0);
});

test("concurrent requests for the same new batch make one model call", async () => {
  const a = await t.signIn("c@example.com");
  const before = t.app.ai.modelCalls;
  const [x, y] = await Promise.all([t.call("/api/ai/course-batch", batch(10), a), t.call("/api/ai/course-batch", batch(10), a)]);
  expect([x.body.cached, y.body.cached].sort()).toEqual([false, true]);
  expect(t.app.ai.modelCalls - before).toBe(1);
});

test("words from your own text spend credits until they run out", async () => {
  const u = await t.signIn("miner@example.com");
  const item = (f: string) => ({ form: f, sentence: `Veo un ${f} aquí.` });
  const r = await t.call("/api/ai/mine", { lang: "es", language: "Spanish", native: "English", items: [item("zorro"), item("búho")], known: ["ver"] }, u);
  expect(r.status).toBe(200);
  expect(r.body.words[0].examples[0].text).toBe("Veo un zorro aquí."); // original sentence kept
  expect(r.body.credits).toMatchObject({ used: 2, left: 23 });

  const many = Array.from({ length: 15 }, (_, i) => item(`w${i}`));
  await t.call("/api/ai/mine", { lang: "es", language: "Spanish", native: "English", items: many, known: [] }, u);
  const out = await t.call("/api/ai/mine", { lang: "es", language: "Spanish", native: "English", items: many, known: [] }, u);
  expect(out.status).toBe(402);
  expect(out.body).toMatchObject({ error: "out_of_credits", left: 8, needed: 15, plan: "free" });
});

test("bad input is rejected before any model call", async () => {
  const u = await t.signIn("bad@example.com");
  const before = t.app.ai.spentThisMonth();
  const r = await t.call("/api/ai/mine", { lang: "spanish!", language: "Spanish", native: "English", items: [], known: [] }, u);
  expect(r.status).toBe(400);
  // Outside the MVP scope: refused before any model call.
  const fr = await t.call("/api/ai/course-batch", { lang: "fr", language: "French", native: "English", cursor: 0, next: 3, forms: ["le"] }, u);
  expect(fr.status).toBe(400);
  const fromGerman = await t.call("/api/ai/course-batch", { lang: "es", language: "Spanish", native: "German", cursor: 0, next: 3, forms: ["de"] }, u);
  expect(fromGerman.status).toBe(400);
  expect((await t.call("/api/ai/mine", { lang: "es" })).status).toBe(401);
  expect(t.app.ai.spentThisMonth()).toBe(before);
});

test("past the monthly budget, AI pauses for everyone", async () => {
  const u = await tight.signIn("budget@example.com");
  expect((await tight.call("/api/ai/course-batch", batch(0), u)).status).toBe(200); // first call spends the budget
  const r = await tight.call("/api/ai/course-batch", batch(3), u);
  expect(r.status).toBe(503);
  expect(r.body.error).toBe("paused");
  expect(r.body.until).toMatch(/^\d{4}-\d{2}-01$/);
  // Cached content still flows.
  expect((await tight.call("/api/ai/course-batch", batch(0), u)).status).toBe(200);
});
