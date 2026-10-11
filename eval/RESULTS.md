# Local model evaluation (2026-10-11)

**Question (#2):** Can a small open model that runs on a learner's device write Perennial's content well enough to teach from?

**Answer: no, not as the main content source.** The best small models are fluent but wrong too often. They make errors a learner cannot detect (wrong grammar, wrong translations, invented words), and the errors are worst at the beginner level, where trust matters most. Use frontier-generated shared content (see #12, #19), and keep local models as an opt-in for tinkerers.

## Setup

- Perennial's real prompts (`web/src/ai/prompts.ts`) run through `eval/run.ts` against `mlx_lm.server`. Models are 4-bit, on an M4 Pro with 48 GB.
- **5 languages:** Spanish, Japanese, Finnish, Arabic, and Thai.
- **3 tasks:**
  - a beginner batch (top-12 frequency forms, no known words)
  - an intermediate batch (forms ranked 300–311, with 150 known words)
  - words mined from a given sentence
- **Grading:** done by Claude (frontier model), reading every successful batch for Spanish and Finnish, and samples for Japanese, Arabic, and Thai. Error rate counts items with an error a learner would not catch: grammar, translation, gloss, lemma, or a sentence that doesn't use the word.
- **No constrained decoding.** In a browser runtime (WebLLM JSON schema, llama.cpp grammars), JSON failures would go away. Content errors would not.

## Scoreboard (mechanical)

| Model | Batches parsed | Words | Cloze found in sentence | Avg time / batch |
|---|---|---|---|---|
| Qwen3.5-9B | 15/15 | 109 | 0.92 | 38s |
| Qwen3.5-4B | 15/15 | 119 | 0.87 | 26s |
| Gemma 4 E4B | 15/15 | 115 | 0.86 | 25s |
| Ministral 3 8B | 11/15 | 69 | 0.81 | 53s |
| Qwen3-4B | 14/15 | 30 | 0.75 | 21s (ignores the batch: 1 word) |
| Qwen3.5-2B | 9/15 | 65 | 0.69 | 32s |
| Gemma 4 E2B | 5/15 | 55 | 0.65 | 21s |
| Ministral 3 3B | 6/15 | 25 | 0.64 | 43s |

## Content quality (graded)

| Model | Spanish | Finnish | Japanese | Arabic / Thai | Typical failures |
|---|---|---|---|---|---|
| Qwen3.5-9B | ~15% | ~40% | beginner broken | not graded in depth | Telegraphic Japanese ("私 知 ます"), Chinese in Japanese ("多謝です"), wrong Finnish cases, changes the mined sentence |
| Gemma 4 E4B | ~25% | ~30% | best beginner (natural) | not graded in depth | "Yo es estudiante", mixed tú/vos, whole sentence as the target word, false grammar notes |
| Qwen3.5-4B | ~25% | ~70% | beginner in romaji | truncated Arabic, Thai beginner sentences in English | Invented words ("pöystinen"), wrong translations, false notes ("Finnish 'se' is feminine") |
| Qwen3.5-2B and smaller | — | — | — | — | Mostly fail to produce usable output. Where they do, errors like the 4B's |

## Practical constraints, even if quality were fine

- Downloads of 2.5–6.5 GB, and 4B+ models need a laptop-class GPU.
- 25–40 s per 12-word batch on an M4 Pro. Phones are slower.
- iOS limits memory per tab.

## Decision

1. **Shared course:** frontier-generated once per language pair, then cached and served to everyone (#12, #19). Hosted mode already caches it this way.
2. **Personal generation:** hosted Perennial AI (Haiku 4.5 by default), or the learner's own cloud key.
3. **Local models:** keep as an opt-in, with a visible warning that small local models make language mistakes.
4. **Re-run** `eval/all.sh` when new small models ship. The harness and freq lists are in the repo.

---

# Follow-up: Spanish and German in depth (MVP languages, 2026-10-11)

After the MVP was narrowed to English speakers learning Spanish and German (#23), I re-ran the eval on those two languages only, at four levels plus mined words:

- **Levels:** frequency ranks 0, 60, 300 and 1,500, each with the earlier words given as known vocabulary.
- **Output:** `eval/out-esde/`. Run with `EVAL_ARGS="--deep --langs es,de" OUT_DIR=eval/out-esde eval/all.sh …`.

**Result: the conclusion holds, even for high-resource languages.** The deeper run found more errors than the first pass did. The earlier "~15% for Spanish" was too generous.

| Model | Batches parsed | Spanish errors | German errors | Typical failures |
|---|---|---|---|---|
| Gemma 4 E4B | 10/10 | ~30% | ~30% | "Yo es estudiante", "Das ist Buch", "Das ist nicht.", examples that don't contain the word, the whole sentence marked as the target word |
| Ministral 3 8B | 3/10 | ~35% (where it answers) | — | Unusable output 7/10 times; mined words returned none. Content is fairly natural but wrong in places: "no = not/yes", "querer + a + infinitive", "que no está frío" (needs *esté*), markdown inside sentences |
| Qwen3.5-9B | 10/10 | ~40–45% | ~40–45% | Classic learner errors taught as correct ("Ich habe nicht Geld", "in einer gute Position", wrong word order), mistranslations ("Me lo dije" → "I told you"), invented words ("Ería"), English inside German ("Komm sofort here!"), the mined sentence rewritten |
| Qwen3.5-4B | stopped at 4/10 | — | — | Stopped early: it was the weakest model in the first run, so the remaining batches would not change the conclusion |

All models also included a name ("Richard") as vocabulary, despite the instruction to skip names.

**What changed in the app because of this run:** if a model marks a "target word" much longer than the word itself, the app finds the word in the sentence instead (`saveGenerated` in `web/src/content/builder.ts`).

**Decision unchanged:** shared course content comes from a frontier model (#12, #19). Local models stay an opt-in with a visible quality warning.
