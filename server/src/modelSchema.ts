// The JSON schema a model is asked to answer in (structured outputs), made
// from the Effect Schema its answer is decoded with. The AI routes (model.ts)
// and the deck generator (scripts/deck/generate.ts) both send it.

import { Schema } from "effect";

/** The regex Schema.Trim's "already trimmed" check compiles to: not what a well-formed prompt field should constrain on. */
const TRIM_PATTERN = "^\\S[\\s\\S]*\\S$|^\\S$|^$";

/** Drops the Trim pattern from every string node, keeping minLength/maxLength. */
function dropTrimPattern(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(dropTrimPattern);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) if (!(k === "pattern" && v === TRIM_PATTERN)) out[k] = dropTrimPattern(v);
    return out;
  }
  return node;
}

type ObjectSchema = { type: "object" } & Record<string, unknown>;
const isObjectSchema = (node: unknown): node is ObjectSchema => typeof node === "object" && node !== null && "type" in node && node.type === "object";

/** The JSON schema for an answer of this shape. Answers are objects (Schema.Struct); anything else is a bug. */
export function modelJsonSchema(schema: Schema.Top): ObjectSchema {
  const json = dropTrimPattern(Schema.toStandardJSONSchemaV1(schema)["~standard"].jsonSchema.output({ target: "draft-2020-12" }));
  if (!isObjectSchema(json)) throw new Error("a model's answer must be an object schema");
  return json;
}
