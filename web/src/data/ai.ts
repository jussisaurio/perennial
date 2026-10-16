// Perennial AI: words from the learner's own texts and fresh sentences. Needs
// a real account (not anonymous). Each word costs one AI word from the
// monthly allowance.

import { Effect, Schema } from "effect";
import { ApiErrorBody, ExamplesOut, Me, MineOut } from "perennial-contract";
import { ApiError, BadAnswer, HttpError, request } from "./http";

const post = <S extends Schema.Decoder<unknown>>(schema: S, path: string, body: unknown) =>
  Effect.runPromise(request(schema, path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

export const getMe = () => Effect.runPromise(request(Me, "/api/me"));

export const mineWords = (lang: string, items: { form: string; sentence: string }[], known: string[]) => post(MineOut, "/api/ai/mine", { lang, items, known });

export const moreExamples = (lang: string, words: { lemma: string; gloss: string; seen: string[] }[], known: string[]) => post(ExamplesOut, "/api/ai/examples", { lang, words, known });

const longDate = (d: Date) => d.toLocaleDateString("en", { month: "long", day: "numeric" });

/** First day of next month, when AI words reset. */
export const resetDate = () => {
  const d = new Date();
  return longDate(new Date(d.getFullYear(), d.getMonth() + 1, 1));
};

const formatDate = (iso: string) => (iso ? longDate(new Date(`${iso}T00:00:00`)) : "next month");

const SOMETHING_WRONG = "Something went wrong. Try again later.";
const signInForAI = () => "Sign in with your email to use Perennial AI.";
const somethingWrong = () => SOMETHING_WRONG;

/** What to tell the learner for each error code. Every code is here, so a new one does not compile until it has a line. */
const message = ApiErrorBody.match({
  out_of_credits: ({ left }) =>
    // With a count of 0 the learner can't select fewer: they wait.
    left > 0 ? `You have only ${left} AI words left this month. Select fewer words, or wait until ${resetDate()}.` : "You used all your AI words for this month.",
  busy: () => "Perennial AI is very busy now. Try again in a few minutes.",
  paused: ({ until }) => `Perennial AI is paused until ${formatDate(until)} because it reached its monthly cost limit.`,
  ai_off: () => "Perennial AI is not available on this server.",
  quota: () => "You have too many of your own words and sentences to add more. Delete some on the Words screen (From my texts) first.",
  slow_down: () => "Too many requests. Wait a moment and try again.",
  account_required: signInForAI,
  sign_in_required: signInForAI,
  body_too_large: somethingWrong,
  bad_request: somethingWrong,
  cross_origin: somethingWrong,
  json_only: somethingWrong,
  not_found: somethingWrong,
  method_not_allowed: somethingWrong,
  please_reload: somethingWrong,
  unknown_shape: somethingWrong,
  unknown_table: somethingWrong,
  unknown_word: somethingWrong,
  review_from_the_future: somethingWrong,
  garden_from_the_future: somethingWrong,
  ai_unreachable: somethingWrong,
  ai_error: somethingWrong,
  bad_output: somethingWrong,
  no_mail: somethingWrong,
  internal_error: somethingWrong,
});

/** Plain-language text for errors the learner can act on. */
export function apiMessage(e: unknown): string {
  if (e instanceof ApiError) return message(e.body);
  // A code this app does not know yet, a proxy's error page, or an answer that breaks the contract: never their raw words.
  if (e instanceof HttpError || e instanceof BadAnswer || Schema.isSchemaError(e)) return SOMETHING_WRONG;
  // No connection ("Failed to fetch"), or the app's own words ("Perennial is open in another tab").
  return e instanceof Error ? e.message : String(e);
}
