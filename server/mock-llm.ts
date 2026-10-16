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
    { text: `Hay ${form} allí.`, translation: `There is "${form}" there.`, cloze: form },
    { text: `Busco ${form} hoy.`, translation: `I look for "${form}" today.`, cloze: form },
  ].slice(0, form.startsWith("chatty") ? 5 : 3); // test hook: more sentences than asked for
  // Test hooks: output longer than /api/write takes (the server must clamp or drop it).
  const gloss = form.startsWith("longgloss") ? "g".repeat(200) : `[mock] ${form}`;
  const notes = form.startsWith("longnote") ? "n".repeat(1000) : "Placeholder from mock-llm.ts — not real content.";
  return { lemma: form, gloss, pos: "mock", forms: [form], notes, examples };
}

// A valid deck source entry (scripts/deck/generate.ts --mock).
function deckWord(lemma: string, pos: string) {
  const sentences = [`Veo ${lemma} aquí.`, `¿Dónde está ${lemma}?`, `Me gusta ${lemma} mucho.`].map((text) => ({ text, translation: `(translation of: ${text})`, cloze: lemma }));
  return { lemma, gloss: `[mock] ${lemma}`, pos, forms: [lemma], ...(pos === "noun" ? { gender: "m" } : {}), notes: "Placeholder from mock-llm.ts.", sentences };
}

/** A capture group the pattern always has. */
function group(m: RegExpMatchArray, i: number): string {
  const g = m[i];
  if (g === undefined) throw new Error(`no group ${i} in ${m[0]}`);
  return g;
}

function reply(prompt: string): unknown {
  if (prompt.includes('{"ok": true}')) return { ok: true };
  const surface = prompt.match(/^Surface forms \(most frequent first\):\n(.+)$/m);
  if (surface) return { lemmas: group(surface, 1).split(", ").map((f) => ({ lemma: f, pos: "noun" })) };
  const deck = [...prompt.matchAll(/^- lemma: (.+?) \| pos: (\w+)/gm)];
  if (deck.length) return { words: deck.map((m) => deckWord(group(m, 1), group(m, 2))) };
  const freq = prompt.match(/in frequency order:\n(.+)\n/);
  if (freq) return { words: group(freq, 1).split(", ").map((f) => entry(f)) };
  const mined = [...prompt.matchAll(/^- "(.+?)" in: (.+)$/gm)];
  if (mined.length) return { words: mined.map((m) => entry(group(m, 1), group(m, 2))) };
  const more = [...prompt.matchAll(/^- (\S+) \(/gm)];
  if (more.length)
    return {
      examples: more.flatMap((m) => {
        const l = group(m, 1);
        // Test hook: a chatty model writes 5 per word and one for a word nobody asked for.
        const n = l.startsWith("chatty") ? 5 : 3;
        const own = Array.from({ length: n }, (_, k) => ({ lemma: l, text: `Frase nueva ${k + 1} con ${l}.`, translation: `New sentence ${k + 1} with ${l}.`, cloze: l }));
        return l.startsWith("chatty") ? [...own, { lemma: "stray", text: "Frase con stray.", translation: "A sentence with stray.", cloze: "stray" }] : own;
      }),
    };
  return {};
}

// PORT=0 lets the system pick a free port; the line below says which (server tests read it).
const server = Bun.serve({
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
console.log(`mock LLM on http://localhost:${server.port} (OpenAI: /v1/chat/completions, Anthropic: /v1/messages)`);
