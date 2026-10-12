// Perennial AI: words from the learner's own texts and fresh sentences. Needs
// a real account (not anonymous). Each word costs one AI word from the
// monthly allowance.

import { ApiError, readResponse } from "./http";

export interface GenExample {
  text: string;
  translation: string;
  cloze: string;
}

export interface GenWord {
  lemma: string;
  gloss: string;
  pos: string;
  forms: string[];
  notes?: string;
  examples: GenExample[];
}

export interface Credits {
  used: number;
  limit: number;
  left: number;
  period: string;
}

export interface Me {
  id: string;
  email: string | null;
  anonymous: boolean;
  credits: Credits;
  ai: boolean;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (await readResponse(res)) as T;
}

export const getMe = () => api<Me>("/me");

export const mineWords = (lang: string, items: { form: string; sentence: string }[], known: string[]) => api<{ words: GenWord[]; credits: Credits; model: string }>("/ai/mine", { lang, items, known });

export const moreExamples = (lang: string, words: { lemma: string; gloss: string; seen: string[] }[], known: string[]) =>
  api<{ examples: (GenExample & { lemma: string })[]; credits: Credits; model: string }>("/ai/examples", { lang, words, known });

const longDate = (d: Date) => d.toLocaleDateString("en", { month: "long", day: "numeric" });

/** First day of next month, when AI words reset. */
export const resetDate = () => {
  const d = new Date();
  return longDate(new Date(d.getFullYear(), d.getMonth() + 1, 1));
};

const formatDate = (iso: string) => (iso ? longDate(new Date(`${iso}T00:00:00`)) : "next month");

/** Plain-language text for errors the learner can act on. */
export function apiMessage(e: unknown): string {
  if (!(e instanceof ApiError)) return e instanceof Error ? e.message : String(e);
  switch (e.code) {
    case "out_of_credits": {
      // The server says how many are left: with an unknown count the app lets a learner ask for more.
      const left = Number(e.detail.left);
      return left > 0 ? `You have only ${left} AI words left this month. Select fewer words, or wait until ${resetDate()}.` : "You used all your AI words for this month.";
    }
    case "busy":
      return "Perennial AI is very busy now. Try again in a few minutes.";
    case "paused":
      return `Perennial AI is paused until ${formatDate(String(e.detail.until ?? ""))} because it reached its monthly cost limit.`;
    case "ai_off":
      return "Perennial AI is not available on this server.";
    case "slow_down":
      return "Too many requests. Wait a moment and try again.";
    case "account_required":
    case "sign_in_required":
      return "Sign in with your email to use Perennial AI.";
    default:
      return "Something went wrong. Try again later.";
  }
}
