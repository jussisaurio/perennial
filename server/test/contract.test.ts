// The app decodes the server's answers with the contract (web/src/data, #333).
// Every answer it reads, and every error body, must decode.

import { afterAll, expect, test } from "bun:test";
import { Schema } from "effect";
import { ApiErrorBody, ExamplesOut, Me, MineOut, ServerInfo, WriteResult } from "perennial-contract";
import { QUOTA } from "../src/sync";
import { review, startApp, stopMockLLM, unique, W } from "./helpers";

const t = await startApp();
afterAll(async () => (await t.stop(), stopMockLLM()));

const decodes = (schema: Schema.Decoder<unknown>, body: unknown) => Schema.decodeUnknownSync(schema)(body);

test("answers decode with the contract", async () => {
  decodes(ServerInfo, (await t.call("/api/server")).body);
  const cookie = await t.signIn(unique("contract"));
  decodes(Me, (await t.call("/api/me", undefined, cookie)).body);
  decodes(WriteResult, (await t.write(cookie, [review(W.a)])).body);
  decodes(MineOut, (await t.call("/api/ai/mine", { lang: "es", items: [{ form: "zorro", sentence: "Veo un zorro." }], known: [] }, cookie)).body);
  decodes(ExamplesOut, (await t.call("/api/ai/examples", { lang: "es", words: [{ lemma: "zorro", gloss: "fox", seen: [] }], known: [] }, cookie)).body);
});

test("error bodies decode with the contract, with their status", async () => {
  const cookie = await t.signIn(unique("contract-errors"));
  const signedOut = await t.write("", [review(W.a)]);
  const saved = QUOTA.reviewsPerDay;
  QUOTA.reviewsPerDay = 0;
  try {
    const quota = await t.write(cookie, [review(W.b)]);
    for (const res of [signedOut, quota]) expect(decodes(ApiErrorBody, res.body)).toBeDefined();
    expect({ status: quota.status, error: quota.body.error, table: quota.body.table }).toEqual({ status: 429, error: "quota", table: "reviewsPerDay" });
  } finally {
    QUOTA.reviewsPerDay = saved;
  }
  expect(signedOut.status).toBe(401);
});
