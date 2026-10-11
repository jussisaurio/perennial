// CI gate for decks: schema + invariants, deck.json up to date with source,
// and compatibility with the deck at a base git ref.
//   bun scripts/deck/check.ts [--base origin/main]
// Big changes (over 5% of live words retired) fail unless DECK_ALLOW_BIG_CHANGE=1.

import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { DECK_LANGS, Deck, compatibility, deckProblems } from "../../web/src/deck/schema.ts";
import { ROOT, buildDeck, deckDir, readDeckFiles, readSource, toJson } from "./lib.ts";

const args = process.argv.slice(2);
const baseAt = args.indexOf("--base");
const base = baseAt >= 0 ? args[baseAt + 1] : "origin/main";
const MAX_RETIRED_SHARE = 0.05;
const allowBig = process.env.DECK_ALLOW_BIG_CHANGE === "1";

/** The file at a git ref, or null when the ref has no such file. Exits if the ref is unknown. */
function atRef(ref: string, path: string): string | null {
  const known = Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], { cwd: ROOT });
  if (known.exitCode !== 0) {
    console.error(`unknown git ref "${ref}" (in CI, check out with fetch-depth: 0)`);
    process.exit(2);
  }
  const r = Bun.spawnSync(["git", "show", `${ref}:${path}`], { cwd: ROOT });
  return r.exitCode === 0 ? r.stdout.toString() : null;
}

let failed = false;
const fail = (msg: string) => {
  console.error(`  ✗ ${msg}`);
  failed = true;
};

for (const lang of DECK_LANGS) {
  const path = join(deckDir(lang), "deck.json");
  console.log(`\n${lang}:`);
  if (!existsSync(path)) {
    console.log("  no deck yet");
    continue;
  }

  // 1. Schema and invariants.
  const parsed = Deck(lang).safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    for (const i of parsed.error.issues.slice(0, 20)) fail(`deck.${i.path.join(".")}: ${i.message}`);
    continue;
  }
  const deck = parsed.data;
  for (const p of deckProblems(deck)) fail(p);

  // 2. Up to date with source: rebuilding changes nothing.
  const source = readSource(lang);
  for (const e of source.errors) fail(e);
  const files = readDeckFiles(lang);
  const rebuilt = buildDeck({ lang, source: source.words, ...files });
  for (const e of rebuilt.errors) fail(e);
  for (const w of rebuilt.warnings) console.log(`  ! ${w}`);
  const idsPath = join(deckDir(lang), "ids.json");
  const stale = toJson(rebuilt.deck) !== readFileSync(path, "utf8") || !existsSync(idsPath) || toJson(rebuilt.manifest) !== readFileSync(idsPath, "utf8");
  if (stale) fail(`deck.json or ids.json is out of date with source: run bun scripts/deck/build.ts ${lang}`);

  const live = deck.words.filter((w) => !w.retired).length;
  console.log(`  version ${deck.version}, ${live} live words, ${deck.sentences.filter((s) => !s.retired).length} live sentences`);

  // 3. Compatibility with the deck at the base ref.
  const prevText = atRef(base, `decks/${lang}/deck.json`);
  if (prevText === null) {
    console.log(`  no deck at ${base}: compatibility check skipped`);
    continue;
  }
  const prevParsed = Deck(lang).safeParse(JSON.parse(prevText));
  if (!prevParsed.success) {
    fail(`deck at ${base} doesn't parse with today's schema; a schema change must stay backward compatible`);
    continue;
  }
  const prev = prevParsed.data;
  const c = compatibility(prev, deck);
  const prevWords = new Map(prev.words.map((w) => [w.id, w]));
  const prevSentences = new Map(prev.sentences.map((s) => [s.id, s]));
  const sAdded = deck.sentences.filter((s) => !prevSentences.has(s.id)).length;
  const sRetired = deck.sentences.filter((s) => s.retired && prevSentences.has(s.id) && !prevSentences.get(s.id)!.retired).length;
  console.log(
    `  vs ${base} (version ${prev.version}): words ${c.added} added, ${c.edited} edited, ${c.retired} retired (${(c.retiredShare * 100).toFixed(1)}%); sentences ${sAdded} added, ${sRetired} retired`,
  );
  const list = (label: string, ws: { lemma: string }[]) => {
    if (ws.length) console.log(`  ${label}: ${ws.slice(0, 30).map((w) => w.lemma).join(", ")}${ws.length > 30 ? ", …" : ""}`);
  };
  list("added", deck.words.filter((w) => !prevWords.has(w.id)));
  list("retired", deck.words.filter((w) => w.retired && prevWords.has(w.id) && !prevWords.get(w.id)!.retired));
  for (const e of c.errors) fail(e);
  if (c.retiredShare > MAX_RETIRED_SHARE) {
    if (allowBig) console.log("  big change approved by DECK_ALLOW_BIG_CHANGE=1");
    else fail(`${(c.retiredShare * 100).toFixed(1)}% of live words retired (limit ${MAX_RETIRED_SHARE * 100}%): set DECK_ALLOW_BIG_CHANGE=1 to approve`);
  }
}

console.log(failed ? "\ndecks: FAILED" : "\ndecks: ok");
process.exit(failed ? 1 : 0);
