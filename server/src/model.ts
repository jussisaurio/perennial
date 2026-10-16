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
  /** The decoded answer; null when the model wrote none. */
  readonly output: A | null;
  readonly refused: boolean;
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
}

export class Model extends Context.Service<
  Model,
  {
    /**
     * Ask for an answer of shape `schema` (structured outputs). The provider's
     * failures are refusals (busy, ai_unreachable, ai_error); an answer that
     * does not fit its shape is a bug (a defect), as the SDK's own parse was.
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
      // In the request's scope, the span's parent is the request's root span
      // (inSentryScope), and the SDK's HTTP call (Sentry's fetch span) hangs under it.
      const res = yield* Effect.tryPromise({
        try: () =>
          inSentryScope(ctx, () =>
            Sentry.startSpan({ name: `ai ${task}`, op: "ai.generate", attributes: { model } }, () =>
              client.messages.parse({
                model,
                max_tokens: 16000,
                system: prompt.system,
                messages: [{ role: "user", content: prompt.user }],
                output_config: { format: jsonSchemaOutputFormat(modelJsonSchema(schema)) },
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
      const output = res.parsed_output === null ? null : yield* Schema.decodeUnknownEffect(schema)(res.parsed_output).pipe(Effect.orDie);
      return { output, refused: res.stop_reason === "refusal", usage: res.usage };
    });

    return Model.of({ ask });
  }),
);
