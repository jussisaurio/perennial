// Builds decks/<lang>/deck.json and ids.json from decks/<lang>/source/*.json.
//   bun scripts/deck/build.ts es [de ...]     (no argument: every language)

import { DECK_LANGS, isDeckLang } from "../../web/src/deck/schema.ts";
import { buildDeck, readDeckFiles, readSource, writeDeckFiles } from "./lib.ts";

const langs = process.argv.slice(2).length ? process.argv.slice(2) : [...DECK_LANGS];
let failed = false;
for (const lang of langs) {
  if (!isDeckLang(lang)) {
    console.error(`unknown language "${lang}" (expected one of ${DECK_LANGS.join(", ")})`);
    process.exit(2);
  }
  const source = readSource(lang);
  const files = readDeckFiles(lang);
  const { deck, manifest, errors, warnings } = buildDeck({ lang, source: source.words, ...files });
  for (const w of warnings) console.warn(`${lang}: warning: ${w}`);
  const all = [...source.errors, ...errors];
  if (all.length) {
    for (const e of all) console.error(`${lang}: ${e}`);
    console.error(`${lang}: not written (${all.length} errors)`);
    failed = true;
    continue;
  }
  writeDeckFiles(lang, deck, manifest);
  const live = deck.words.filter((w) => !w.retired).length;
  const note = files.prev && deck.version === files.prev.version ? "unchanged" : `version ${deck.version}`;
  console.log(`${lang}: ${live} words, ${deck.sentences.filter((s) => !s.retired).length} sentences (${note})`);
}
process.exit(failed ? 1 : 0);
