# Deck content process

Every word and sentence in a deck is written by one author and checked by a
different proofreader. CI enforces this: a source file without a valid
approval, or changed after it was approved, fails the build.

## Word order

Decks are in frequency order: the corpus rank in a subtitle word list (FrequencyWords). Frequency is objective, the same for every language, and easy to keep up as decks grow. `audit.ts` warns when a word sits far from its corpus rank.

The app introduces them in a slightly different order, decided in one place (`courseOrder` in `web/src/content/order.ts`): the kinds of words take turns (noun, verb, noun, a describing word, a grammar word, and again), each kind still in frequency order. Without it, the first sessions would be all grammar words and abstract adverbs (*de, que, no, el* / *ich, nicht, so, der*). Decks are never reordered for this; to make early words easier, write sentences that use words already met.

Garden words are the exception (#209). `decks/<lang>/garden.json` names the word that brings each garden thing (`GARDEN_WORDS` in `web/src/deck/schema.ts`): a cat, rain, a fox. The course places them early and steadily, not by rank, and the audit does not flag their rank. The file lives apart from the source, so naming a word does not change an approved source file. The build fails when a named word is not a live source word, or when one word or one thing is named twice.

Orchard words (#315) work the same way. `decks/<lang>/orchard.json` names the word that plants each orchard tree (`ORCHARD_WORDS`): a tree, an apple, a fig. The course places them steadily after the key. A word names one garden thing or one tree, not both.

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

## Growing the decks

What we learned taking each course from about 1000 to about 2000 words (#422). Read this before the next batch.

### The word list

- **The subtitle list gets noisy past rank 3000.** Most forms there are names (andrew, kurt, vera), inflections of words we have (podría, hiciste), English words, and stage directions (stöhnt). 1000 new words needed corpus ranks up to about 4300. Map forms to lemmas, drop those, and keep a pool of about 100 spare lemmas past the cutoff for replacements.
- **One agent drafts the list and another reviews it.** The review changed about 40 of 1000 rows: ranks raised by a name (Bella, Marco) or by subtitle credits (Übersetzung), forms that belong to a more common word, and words with little use for adult beginners.
- **Mark synonyms before anyone writes.** A new word with the same meaning as a deck word (trabajo/empleo, Maschine/Gerät) makes an ambiguous cloze card: the learner types the older word. Note the older word on the row. Drop near-exact variants (weswegen next to warum, wieso and weshalb; Kram next to Zeug).
- **Spanish is Spain Spanish** (coche, conducir, ordenador, vosotros, vídeo, zumo, céntimo). Drop Latin American twins of deck words (computadora, celular, enojado, jugo), or put them only in notes.
- **Check the themes that frequency misses.** The subtitle ranks left most months out of the Spanish course. Check days, months, numbers and other closed sets by hand.

### Writing the sentences

Nearly every proofreading fix in #422 was one of these. Grammar errors were close to zero.

- **The cloze test.** If a new sentence is an older sentence with one word swapped ("Das ist mir vollkommen egal." next to "Das ist mir völlig egal.") or added ("Gib mir deine rechte Hand." next to "Gib mir deine Hand."), the learner answers the older word. Write a new situation instead.
- **Search the deck by meaning, not only words.** Grep each sentence's frame without its target word ("para cenar", "al final del pasillo"), and grep the sentences of every older synonym. `draft.ts check` finds echoes that share words; only a grep by meaning finds the rest.
- **Avoid the worn openings.** `draft.ts frames <lang>` lists the openings the deck already uses 4 or more times ("Das ist X", "Es un X", "No hay X", "Die Polizei hat…"). Don't start a new sentence with one.
- **Days and months** almost always copy another day's sentence ("closed on X", "market on X", "see you on X"). Grep every day and month first.
- **Make the gloss and translation rule out the older word.** "instead of (a longer form of statt)"; "states", not "countries", when Länder exists. The English must not repeat an older card's English word for word, and must stand on its own ("Schmeckt es dir?" is "Does it taste good?", not "Do you like it?").
- **Use the setting a native lives in.** Kilometres, not miles; "leña" for firewood; "hacer la maleta" for packing in Spain.
- **Notes must be exactly true,** and every gloss sense needs a sentence. Nouns with a common plural get a plural sentence.
- **One frame per file.** Don't cluster a topic or repeat a pattern inside one file either.
- **A gloss that copies an older word's gloss collides in every sentence.** "to use", "exciting" and "usually" were already taken. Name the difference ("a bit more formal than benutzen"), or choose a sense the older word can't take.
- **Grep the English too.** Older pairs often hide in the translations: desgracia was already "tragedy", and comer was already "have lunch".
- **Sets of related words** (compass points, numbers, school subjects, languages) need a different frame for each word. "Der Wind kommt von Westen" next to "…von Osten" fails the cloze test.

### Running it with agents

- **Pilot first.** Write and proofread one file per language, turn its findings into rules for the author brief, then write the rest in waves of three files per language. After each wave, add the new lessons to the brief.
- **Draft outside `decks/`.** Authors write drafts elsewhere, check them with `draft.ts check`, and copy a file into `decks/<lang>/source/` only when it has no errors. Then parallel authors never see a broken file.
- **Every agent keeps its helper files in its own folder.** Parallel agents overwrote each other's shared scripts. `proof.ts mark` refused the wrong file or reviewer, so no wrong verdict landed. Before finishing, check that `proof.ts status` agrees with every verdict.
- **Suggested replacements need the same checks.** Proofreaders' own replacement sentences were often reused frames or had rare words.
- **Small exact fixes can be applied by whoever runs the batch.** This saves a round trip. Only the proofreader marks entries ok.
- **Fix rates per 100 entries rose as the deck grew:** 7 and 11 for the pilots, 11–31 in the first wave, then 7–36 and 19–62 in the later waves. Grammar errors stayed near zero. Nearly every fix was a near-copy of an older sentence. With 2000 words, every new sentence has many more older sentences to echo. `draft.ts check` caught few of these, and proofreaders wrote their own similarity scripts to find them (#428). Before the next batch, give authors a ranked "closest sentences" search.
- **Files written in parallel echo each other.** When two new files clash, change the one that is not yet approved, or the later one in the course. Tell the editors of both files about the pair.
- **Rebuild deck.json and ids.json from main's at the end.** Words swapped out of the list during review (celular, enojado) otherwise keep an id as retired words that never shipped.
- **Agents can stop on a usage limit.** Their context survives: a message resumes each one where it stopped. Drafts outside `decks/` and verdicts already in the ledger are safe.

## Tools

- `bun scripts/deck/build.ts <lang>`: rebuilds `deck.json` and `ids.json` from source.
- `bun scripts/deck/audit.ts [lang]`: duplicates (sentences, lemmas, shared forms), rare words, corpus rank drift, comprehensibility (share of a sentence's other words already met), cognates. Errors fail CI.
- `bun scripts/deck/proof.ts next|mark|status`: the one-entry-at-a-time proofreading ledger.
- `bun scripts/deck/sheet.ts <lang> NNNN [--only-flagged]`: an overview page of a file with all flags (for skimming, not for the verdicts).
- `bun scripts/deck/review.ts <lang> NNNN --author … --reviewer …`: records an approval.
- `bun scripts/deck/check.ts --base origin/main`: the CI gate (schema, invariants, approvals, up to date, compatibility).
- `bun scripts/deck/draft.ts check <lang> <NNNN> <draft.json>`: checks a draft against the deck without writing anything: schema, duplicates, shared forms, cloze, rare words, and echoes of older sentences (near-duplicate, same-frame). `draft.ts frames <lang>`: the worn sentence openings.
- `bun scripts/deck/generate.ts`: drafts source words with the Anthropic API. Drafts still need a proofreader.
