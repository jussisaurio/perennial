// The model: Anthropic's Messages API through its SDK, one structured answer
// per call. ai.ts decides what to ask and what it costs; this adapter makes
// the call, traces it, and says how it failed.

import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import * as Sentry from "@sentry/bun";
import { Context, Effect, Layer, Schema } from "effect";
import { AppConfig } from "./config";
import { type ApiError, refuse } from "./http";
import { modelJsonSchema } from "./modelSchema";
import { inSentryScope, RequestContext } from "./request";

/** An answer's shape: a Schema.Struct that decodes without services. */
type Shape = Schema.Top & { readonly DecodingServices: never };

export interface Answer<A> {
  /** The decoded answer; null when the model refused or its answer can't be used. */
  readonly output: A | null;
  readonly refused: boolean;
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
}

export class Model extends Context.Service<
  Model,
  {
    /**
     * Ask for an answer of shape `schema` (structured outputs). The provider's
     * failures are refusals (busy, ai_unreachable, ai_error). Once the model
     * has answered, the tokens are billed: the Answer always carries their
     * usage, and an answer that does not fit its shape is logged and comes
     * back as output null, not a defect, so the caller can count its cost.
     */
    readonly ask: <S extends Shape>(task: string, schema: S, prompt: { readonly system: string; readonly user: string }) => Effect.Effect<Answer<S["Type"]>, ApiError, RequestContext>;
  }
>()("perennial/Model") {}

export const ModelLive = Layer.effect(
  Model,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const client = new Anthropic({ apiKey: config.anthropic.apiKey, baseURL: config.anthropic.baseURL });
    const model = config.anthropic.model;

    const ask = Effect.fn("Model.ask")(function* <S extends Shape>(task: string, schema: S, prompt: { readonly system: string; readonly user: string }) {
      const ctx = yield* RequestContext;
      // The SDK's format, without its parse: messages.parse would throw on an
      // answer that is not JSON, and the answer's usage would be lost with it.
      const { type, schema: jsonSchema } = jsonSchemaOutputFormat(modelJsonSchema(schema));
      // In the request's scope, the span's parent is the request's root span
      // (inSentryScope), and the SDK's HTTP call (Sentry's fetch span) hangs under it.
      const res = yield* Effect.tryPromise({
        try: () =>
          inSentryScope(ctx, () =>
            Sentry.startSpan({ name: `ai ${task}`, op: "ai.generate", attributes: { model } }, () =>
              client.messages.create({
                model,
                max_tokens: 16000,
                system: prompt.system,
                messages: [{ role: "user", content: prompt.user }],
                output_config: { format: { type, schema: jsonSchema } },
              }),
            ),
          ),
        catch: (e) => e,
      }).pipe(
        Effect.catch((e) => {
          if (e instanceof Anthropic.RateLimitError) return Effect.fail(refuse({ error: "busy" }));
          if (e instanceof Anthropic.APIConnectionError) return Effect.fail(refuse({ error: "ai_unreachable" }));
          if (e instanceof Anthropic.APIError) return Effect.fail(refuse({ error: "ai_error", status: e.status }));
          return Effect.die(e);
        }),
      );
      const refused = res.stop_reason === "refusal";
      const text = res.content.find((b) => b.type === "text")?.text;
      const output =
        refused || text === undefined
          ? null
          : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(schema))(text).pipe(
              // The error quotes the answer, which can quote the learner's text: log the task and stop reason only.
              Effect.catchTag("SchemaError", () => Effect.as(Effect.logError("model answer unusable").pipe(Effect.annotateLogs({ aiTask: task, stopReason: res.stop_reason })), null)),
            );
      return { output, refused, usage: res.usage };
    });

    return Model.of({ ask });
  }),
);
