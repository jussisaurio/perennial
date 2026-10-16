// The JSON schemas the model is asked to answer in. model-schemas.main.json is
// what the server sent before the move from zod to Effect Schema (zod's
// zodOutputFormat, #322): the model must keep seeing the same shape, with the
// same limits told as hints.

import { afterAll, expect, test } from "bun:test";
import { mockLLM, startApp, stopMockLLM, unique } from "./helpers";

/** A stand-in for the model's API that keeps each request body and passes it on to the mock. */
const bodies: { output_config?: { format?: unknown } }[] = [];
const upstream = await mockLLM();
const capture = Bun.serve({
  port: 0,
  async fetch(req) {
    const body = await req.text();
    bodies.push(JSON.parse(body));
    const url = new URL(req.url);
    return fetch(upstream + url.pathname + url.search, { method: req.method, headers: req.headers, body });
  },
});
const t = await startApp({ anthropic: { apiKey: "test-key", baseURL: `http://localhost:${capture.port}`, model: "claude-haiku-4-5" } });
afterAll(async () => (await t.stop(), capture.stop(true), stopMockLLM()));

/**
 * Two differences carry no meaning, and are left out (as for the deck
 * generator in #326): zod named a repeated shape in $defs and pointed at it
 * with $ref, where Effect writes it in place; and zod's schema declared its
 * dialect, "$schema", which the SDK turns into a description of the root.
 */
function normalize(schema: unknown): unknown {
  const root = schema as { $defs?: Record<string, unknown>; description?: string };
  const inline = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(inline);
    if (!node || typeof node !== "object") return node;
    const ref = (node as { $ref?: string }).$ref;
    if (ref) return inline(root.$defs?.[ref.replace("#/$defs/", "")]);
    return Object.fromEntries(Object.entries(node).filter(([k]) => k !== "$defs").map(([k, v]) => [k, inline(v)]));
  };
  const out = inline(schema) as Record<string, unknown>;
  if (typeof root.description === "string" && root.description.startsWith("{$schema:")) delete out.description;
  return out;
}

const main = (await Bun.file(new URL("./model-schemas.main.json", import.meta.url)).json()) as Record<"mine" | "examples", { type: string; schema: unknown }>;

test("the model is asked for the same shapes as before", async () => {
  const cookie = await t.signIn(unique("schema"));
  expect((await t.call("/api/ai/mine", { lang: "es", items: [{ form: "zorro", sentence: "Veo un zorro." }], known: [] }, cookie)).status).toBe(200);
  expect((await t.call("/api/ai/examples", { lang: "es", words: [{ lemma: "zorro", gloss: "fox", seen: [] }], known: [] }, cookie)).status).toBe(200);
  const [mine, examples] = bodies.map((b) => b.output_config?.format as { type: string; schema: unknown });
  expect(JSON.stringify({ type: mine?.type, schema: normalize(mine?.schema) }, null, 2)).toBe(JSON.stringify({ type: main.mine.type, schema: normalize(main.mine.schema) }, null, 2));
  expect(JSON.stringify({ type: examples?.type, schema: normalize(examples?.schema) }, null, 2)).toBe(JSON.stringify({ type: main.examples.type, schema: normalize(main.examples.schema) }, null, 2));
});
