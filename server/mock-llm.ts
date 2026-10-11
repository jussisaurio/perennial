// Fake Anthropic Messages endpoint for developing and testing Perennial offline.
//   bun mock-llm.ts   ->  start the server with ANTHROPIC_BASE_URL=http://localhost:8788
// Returns structurally valid PLACEHOLDER content (fixed templates, fake glosses)
// for each prompt Perennial sends. It tests plumbing, not language quality.

const PORT = Number(process.env.PORT ?? 8788);

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-allow-methods": "POST, OPTIONS",
};

function entry(form: string, sentence?: string) {
  const examples = [
    ...(sentence ? [{ text: sentence, translation: `(translation of: ${sentence})`, cloze: form }] : []),
    { text: `Yo veo ${form} aquí.`, translation: `I see "${form}" here.`, cloze: form },
    { text: `¿Dónde está ${form}?`, translation: `Where is "${form}"?`, cloze: form },
    { text: `Me gusta ${form} mucho.`, translation: `I like "${form}" a lot.`, cloze: form },
  ].slice(0, 3);
  return { lemma: form, gloss: `[mock] ${form}`, pos: "mock", forms: [form], notes: "Placeholder from mock-llm.ts — not real content.", examples };
}

// A valid deck source entry (scripts/deck/generate.ts --mock).
function deckWord(lemma: string, pos: string) {
  const sentences = [`Veo ${lemma} aquí.`, `¿Dónde está ${lemma}?`, `Me gusta ${lemma} mucho.`].map((text) => ({ text, translation: `(translation of: ${text})`, cloze: lemma }));
  return { lemma, gloss: `[mock] ${lemma}`, pos, forms: [lemma], ...(pos === "noun" ? { gender: "m" } : {}), notes: "Placeholder from mock-llm.ts.", sentences };
}

function reply(prompt: string): unknown {
  if (prompt.includes('{"ok": true}')) return { ok: true };
  const surface = prompt.match(/^Surface forms \(most frequent first\):\n(.+)$/m);
  if (surface) return { lemmas: surface[1].split(", ").map((f) => ({ lemma: f, pos: "noun" })) };
  const deck = [...prompt.matchAll(/^- lemma: (.+?) \| pos: (\w+)/gm)];
  if (deck.length) return { words: deck.map(([, l, pos]) => deckWord(l, pos)) };
  const freq = prompt.match(/in frequency order:\n(.+)\n/);
  if (freq) return { words: freq[1].split(", ").map((f) => entry(f)) };
  const mined = [...prompt.matchAll(/^- "(.+?)" in: (.+)$/gm)];
  if (mined.length) return { words: mined.map(([, f, s]) => entry(f, s)) };
  const more = [...prompt.matchAll(/^- (\S+) \(/gm)];
  if (more.length)
    return { examples: more.flatMap(([, l]) => [1, 2, 3].map((i) => ({ lemma: l, text: `Frase nueva ${i} con ${l}.`, translation: `New sentence ${i} with ${l}.`, cloze: l }))) };
  return {};
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const path = new URL(req.url).pathname;
    const body = (await req.json().catch(() => ({}))) as { system?: string; messages?: { content: string }[] };
    const prompt = [body.system ?? "", ...(body.messages?.map((m) => m.content) ?? [])].join("\n");
    await Bun.sleep(150);
    const text = JSON.stringify(reply(prompt));
    if (path.endsWith("/messages")) {
      // Anthropic Messages API shape, for the hosted server's SDK calls.
      return Response.json(
        {
          id: `msg_mock_${Date.now()}`,
          type: "message",
          role: "assistant",
          model: "mock",
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: Math.ceil(prompt.length / 4), output_tokens: Math.ceil(text.length / 4) },
        },
        { headers: cors },
      );
    }
    return Response.json({ choices: [{ message: { role: "assistant", content: text } }] }, { headers: cors });
  },
});
console.log(`mock LLM on http://localhost:${PORT} (OpenAI: /v1/chat/completions, Anthropic: /v1/messages)`);
