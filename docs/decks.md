# Deck content process

Every word and sentence in a deck is written by one author and checked by a
different proofreader. CI enforces this: a source file without a valid
approval, or changed after it was approved, fails the build.

## Word order

Decks are in frequency order: the corpus rank in a subtitle word list (FrequencyWords). Frequency is objective, the same for every language, and easy to keep up as decks grow. `audit.ts` warns when a word sits far from its corpus rank.

The app introduces them in a slightly different order, decided in one place (`courseOrder` in `web/src/content/order.ts`): the kinds of words take turns (noun, verb, noun, a describing word, a grammar word, and again), each kind still in frequency order. Without it, the first sessions would be all grammar words and abstract adverbs (*de, que, no, el* / *ich, nicht, so, der*). Decks are never reordered for this; to make early words easier, write sentences that use words already met.

## Roles

- **Author**: writes source entries (`decks/<lang>/source/NNNN.json`), by hand or with `scripts/deck/generate.ts`. Model output counts as authored by the person or agent that ran it.
- **Proofreader**: a different person or agent, with a fresh context. Reads every entry against the checklist below and writes findings. Never fixes entries silently.
- **Editor**: applies the proofreader's findings. Usually the author.

The author and the proofreader must be different. The approval record names both. For agents, use distinct names that include the role, for example `claude-agent:es-author-2026-10-11` and `claude-agent:es-proofreader-2026-10-11`.

## Steps

1. **Write.** The author adds or changes source files (100 words each), runs `bun scripts/deck/build.ts <lang>`, fixes every build error and warning, and runs `bun scripts/deck/audit.ts <lang>` to clean up duplicates and rare words.
2. **Proofread, one entry at a time.** The proofreader works through the file with the ledger tool, never by reading the whole file at once:
   - `bun scripts/deck/proof.ts next <lang> NNNN` shows the next entry to judge: the word, its sentences, and the automatic flags (audit, cloze, length).
   - Judge it against the checklist, then record a verdict: `proof.ts mark <lang> NNNN "<lemma|pos>" ok --reviewer <name>`, or `fix --note "s2: …; gloss: …"` with the exact change.
   - Repeat until `next` says every entry is judged. The ledger (`decks/<lang>/reviews/NNNN.ledger.json`) records a verdict for every entry, tied to a hash of that entry. Several proofreaders can split a deck by file; one proofreader owns each file's ledger.
3. **Fix.** The editor (usually the author) runs `proof.ts status <lang> NNNN` to list every open fix, applies them, and rebuilds. Disagreements go back to the proofreader, who decides.
4. **Re-check.** Edited entries change their hash, so `proof.ts next` hands the proofreader exactly those entries again. When everything is "ok", the proofreader approves:
   `bun scripts/deck/review.ts <lang> NNNN --author <author> --reviewer <proofreader> --notes "<summary>"`
   `review.ts` refuses unless the proofreader's ledger has every entry "ok" as it is now.
5. **Ship.** `bun scripts/deck/check.ts` passes: it checks the approval, the file hash, and the full ledger.

Any later edit to an entry needs a new verdict for that entry and a new approval for the file.

## Proofreading checklist

For each **word**:
- The lemma is the dictionary form, spelled correctly (accents, ñ, umlauts, ß, noun capitalisation in German).
- The part of speech is right. Nouns have the right gender.
- The gloss is accurate for the most common sense, in plain English that a non-native reader understands. It does not mix two senses unless both are common.
- The forms are real, frequent forms of this word (and only of this word).
- The notes, if any, are correct and useful (irregular forms, a common trap).

For each **sentence**:
- **Grammar:** fully correct (agreement, cases, verb forms, word order, accents and punctuation such as ¿ ¡).
- **Meaning:** it makes sense on its own. It is something a person would plausibly say. It is not contradictory or absurd.
- **Target sense:** the word is used in the sense of the gloss, with its part of speech (a conjunction is used as a conjunction, not as a noun).
- **Natural:** a native speaker would say it this way; no translated-from-English phrasing.
- **Level:** short (12 words or fewer), built mostly from very common words; no rare vocabulary that would distract a beginner.
- **Translation:** faithful and natural English; it neither adds nor drops meaning.
- **Cloze:** the exact form in the sentence that realises the target word, once, as a whole word; not a different word that happens to share letters.
- **Variety:** across a word's sentences, different contexts, and different forms where the word has them (persons and tenses for verbs, singular and plural, cases).
- **Appropriate:** nothing offensive, nothing that dates quickly, no real people or brands.

## Tools

- `bun scripts/deck/build.ts <lang>`: rebuilds `deck.json` and `ids.json` from source.
- `bun scripts/deck/audit.ts [lang]`: duplicates (sentences, lemmas, shared forms), rare words, corpus rank drift, comprehensibility (share of a sentence's other words already met), cognates. Errors fail CI.
- `bun scripts/deck/proof.ts next|mark|status`: the one-entry-at-a-time proofreading ledger.
- `bun scripts/deck/sheet.ts <lang> NNNN [--only-flagged]`: an overview page of a file with all flags (for skimming, not for the verdicts).
- `bun scripts/deck/review.ts <lang> NNNN --author … --reviewer …`: records an approval.
- `bun scripts/deck/check.ts --base origin/main`: the CI gate (schema, invariants, approvals, up to date, compatibility).
- `bun scripts/deck/generate.ts`: drafts source words with the Anthropic API. Drafts still need a proofreader.
