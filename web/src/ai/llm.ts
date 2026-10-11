// Provider-agnostic LLM client. Two wire formats cover nearly everything:
// OpenAI-style chat completions (OpenAI, OpenRouter, Groq, Together, Mistral,
// Gemini's OpenAI endpoint, Ollama, LM Studio, llama.cpp…) and Anthropic's
// Messages API.

import { getMeta, setMeta } from "../db/db";

export interface LLMConfig {
  dialect: "openai" | "anthropic";
  baseUrl: string;
  model: string;
  apiKey: string;
}

export const PRESETS: Record<string, Omit<LLMConfig, "apiKey">> = {
  OpenAI: { dialect: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-5-mini" },
  Anthropic: { dialect: "anthropic", baseUrl: "https://api.anthropic.com/v1", model: "claude-haiku-4-5-20251001" },
  OpenRouter: { dialect: "openai", baseUrl: "https://openrouter.ai/api/v1", model: "google/gemini-2.5-flash" },
  "Ollama (local)": { dialect: "openai", baseUrl: "http://localhost:11434/v1", model: "qwen3:8b" },
};

export const getLLMConfig = () => getMeta<LLMConfig | null>("llm", null);
export const setLLMConfig = (c: LLMConfig | null) => setMeta("llm", c);

export class LLMError extends Error {}

export const isLocalUrl = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|[^/]+\.local)(:|\/|$)/.test(url);

const MAX_OUTPUT = 8000;
/** Local models can be slow, but a hung server must not leave the app waiting forever. */
const TIMEOUT_MS = 180_000;

function withTimeout(signal?: AbortSignal): AbortSignal {
  const t = AbortSignal.timeout(TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, t]) : t;
}

async function complete(cfg: LLMConfig, system: string, user: string, outer?: AbortSignal): Promise<string> {
  const base = cfg.baseUrl.replace(/\/$/, "");
  const signal = withTimeout(outer);
  if (cfg.dialect === "anthropic") {
    const res = await fetch(`${base}/messages`, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
        // The key belongs to the user and never leaves their device except to the provider.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: cfg.model, max_tokens: MAX_OUTPUT, system, messages: [{ role: "user", content: user }] }),
    });
    if (!res.ok) throw new LLMError(`${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { content: { type: string; text?: string }[] };
    return body.content.map((c) => c.text ?? "").join("");
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      // Without a limit some local servers stop after a few hundred tokens and
      // cut the JSON off. OpenAI's own API wants the newer parameter name.
      ...(/api\.openai\.com/.test(base) ? { max_completion_tokens: MAX_OUTPUT } : { max_tokens: MAX_OUTPUT }),
      // Local "thinking" models (Qwen3, Gemma 4) are slow and sometimes put the
      // answer in a separate field; ask them to answer directly. Servers that
      // don't know these fields ignore them.
      ...(isLocalUrl(base) ? { chat_template_kwargs: { enable_thinking: false }, think: false } : {}),
    }),
  });
  if (!res.ok) throw new LLMError(`${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { choices: { message: { content: string | null; reasoning?: string; reasoning_content?: string } }[] };
  const msg = body.choices[0]?.message;
  // Some servers return thinking-only replies; the JSON may still be in there.
  return msg?.content || msg?.reasoning_content || msg?.reasoning || "";
}

/** Pull the first JSON value out of a reply that may include prose, code fences, or <think> blocks. */
export function extractJSON(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "");
  const start = cleaned.search(/[[{]/);
  if (start < 0) throw new LLMError("no JSON in reply");
  const open = cleaned[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
  }
  throw new LLMError("unterminated JSON in reply");
}

/** Ask for JSON, validate it, retry once with the error if it's malformed. */
export async function askJSON<T>(
  system: string,
  user: string,
  validate: (x: unknown) => T,
  opts: { config?: LLMConfig; signal?: AbortSignal } = {},
): Promise<T> {
  const cfg = opts.config ?? (await getLLMConfig());
  if (!cfg) throw new LLMError("No AI model is connected. Connect one in Settings.");
  const sys = `${system}\n\nReply with JSON only. No commentary.`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0 ? user : `${user}\n\nYour previous reply was invalid (${String(lastErr)}). Reply with valid JSON only.`;
    try {
      return validate(extractJSON(await complete(cfg, sys, prompt, opts.signal)));
    } catch (e) {
      if (e instanceof LLMError && /^\d{3}:/.test(e.message)) throw e; // HTTP errors aren't fixed by retrying
      if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) throw e;
      lastErr = e;
    }
  }
  throw new LLMError(`AI reply was unusable: ${String(lastErr)}`);
}
