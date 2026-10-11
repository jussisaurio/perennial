# Deck content process

Every word and sentence in a deck is written by one author and checked by a
different proofreader. CI enforces this: a source file without a valid
approval, or changed after it was approved, fails the build.

## Roles

- **Author**: writes source entries (`decks/<lang>/source/NNNN.json`), by hand or with `scripts/deck/generate.ts`. Model output counts as authored by the person or agent that ran it.
- **Proofreader**: a different person or agent, with a fresh context. Reads every entry against the checklist below and writes findings. Never fixes entries silently.
- **Editor**: applies the proofreader's findings. Usually the author.

The author and the proofreader must be different. The approval record names both. For agents, use distinct names that include the role, for example `claude-agent:es-author-2026-10-11` and `claude-agent:es-proofreader-2026-10-11`.

## Steps

1. **Write.** The author adds or changes source files, runs `bun scripts/deck/build.ts <lang>`, and fixes every build error and warning.
2. **Proofread.** The proofreader checks each entry against the checklist and writes `decks/<lang>/reviews/NNNN.findings.md`: one line per problem, with the lemma, what is wrong, and the exact fix. Entries without problems are not listed. A file with no findings says "No findings".
3. **Fix.** The editor applies the findings and rebuilds. A finding they disagree with gets a reply in the findings file; the proofreader decides.
4. **Verify.** The proofreader rereads the changed entries. If everything is right, they approve the file as it is now:
   `bun scripts/deck/review.ts <lang> NNNN --author <author> --reviewer <proofreader> --notes "<summary>"`
   This writes `decks/<lang>/reviews/NNNN.json` with a hash of the file. If anything is still wrong, go back to step 3.
5. **Ship.** `bun scripts/deck/check.ts` passes, and the pull request shows the deck diff report.

Any later edit to a source file (even a typo fix) invalidates its approval: steps 2–4 run again for that file.

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
- `bun scripts/deck/review.ts <lang> NNNN --author … --reviewer …`: records an approval.
- `bun scripts/deck/check.ts --base origin/main`: the CI gate (schema, invariants, approvals, up to date, compatibility).
- `bun scripts/deck/generate.ts`: drafts source words with the Anthropic API. Drafts still need a proofreader.
