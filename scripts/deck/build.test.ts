import { expect, test } from "bun:test";
import { compatibility, ID_ALPHABET, type Deck, type SourceWord } from "../../web/src/deck/schema.ts";
import { buildDeck, wholeWordCount, wordCount, type Garden, type Manifest, type Orchard } from "./lib.ts";

const src = (lemma: string, extra: Partial<SourceWord> = {}): SourceWord => ({
  lemma,
  gloss: `the ${lemma}`,
  pos: "noun",
  forms: [lemma],
  gender: "f",
  sentences: [1, 2, 3].map((i) => ({ text: `La ${lemma} número ${i}.`, translation: `The ${lemma} number ${i}.`, cloze: lemma })),
  ...extra,
});

/** Deterministic ids: 0000000001, 0000000002, ... */
const counter = () => {
  let n = 0;
  return () => String(++n).padStart(10, "0");
};
const empty = (): Manifest => ({ words: {}, sentences: {} });

test("first build assigns ids, ranks and version 1", () => {
  const r = buildDeck({ lang: "es", source: [src("casa"), src("mesa")], manifest: empty(), prev: null, newBody: counter() });
  expect(r.errors).toEqual([]);
  expect(r.deck.version).toBe(1);
  expect(r.deck.words.map((w) => [w.lemma, w.rank])).toEqual([["casa", 1], ["mesa", 2]]);
  expect(r.deck.words[0].id).toMatch(/^es\.w\.[0-9a-z]{10}$/);
  expect(r.deck.sentences).toHaveLength(6);
  expect(Object.keys(r.manifest.words)).toEqual(["casa|noun|", "mesa|noun|"]);
});

test("random ids are well formed", () => {
  const r = buildDeck({ lang: "de", source: [src("Haus")], manifest: empty(), prev: null });
  expect(r.errors).toEqual([]);
  expect(r.deck.words[0].id).toMatch(new RegExp(`^de\\.w\\.[${ID_ALPHABET}]{10}$`));
});

test("rebuilding is idempotent; edits keep ids and bump the version", () => {
  const ids = counter();
  const a = buildDeck({ lang: "es", source: [src("casa"), src("mesa")], manifest: empty(), prev: null, newBody: ids });
  const same = buildDeck({ lang: "es", source: [src("casa"), src("mesa")], manifest: a.manifest, prev: a.deck, newBody: ids });
  expect(same.deck).toEqual(a.deck);
  expect(JSON.stringify(same.manifest)).toBe(JSON.stringify(a.manifest));

  // Reordered + a gloss fix: same ids, new ranks, version 2.
  const b = buildDeck({ lang: "es", source: [src("mesa"), src("casa", { gloss: "house" })], manifest: a.manifest, prev: a.deck, newBody: ids });
  expect(b.errors).toEqual([]);
  expect(b.deck.version).toBe(2);
  const byLemma = (d: typeof a.deck, l: string) => d.words.find((w) => w.lemma === l)!;
  expect(byLemma(b.deck, "casa").id).toBe(byLemma(a.deck, "casa").id);
  expect(byLemma(b.deck, "casa").rank).toBe(2);
  expect(compatibility(a.deck, b.deck)).toMatchObject({ errors: [], edited: 1, retired: 0 });
});

test("words and sentences leaving the source are retired, not dropped", () => {
  const ids = counter();
  const a = buildDeck({ lang: "es", source: [src("casa"), src("mesa"), src("silla")], manifest: empty(), prev: null, newBody: ids });
  const base = src("casa");
  const casa = { ...base, sentences: base.sentences.map((s, i) => (i === 0 ? { text: "Mi casa es grande.", translation: "My house is big.", cloze: "casa" } : s)) };
  const b = buildDeck({ lang: "es", source: [casa, src("silla"), src("gato")], manifest: a.manifest, prev: a.deck, newBody: ids });
  expect(b.errors).toEqual([]);
  const mesa = b.deck.words.find((w) => w.lemma === "mesa")!;
  expect(mesa.retired).toBe(true);
  expect(mesa.rank).toBe(2); // keeps its old rank
  expect(b.deck.sentences.filter((s) => s.wordId === mesa.id).every((s) => s.retired)).toBe(true);
  // The edited sentence is a new sentence; the old one is retired.
  const casaId = b.deck.words.find((w) => w.lemma === "casa")!.id;
  const casaSentences = b.deck.sentences.filter((s) => s.wordId === casaId);
  expect(casaSentences.map((s) => !!s.retired)).toEqual([false, false, false, true]);
  const c = compatibility(a.deck, b.deck);
  expect(c).toMatchObject({ errors: [], added: 1, retired: 1 });
});

test("a word that comes back gets a fresh id (no un-retiring)", () => {
  const ids = counter();
  const a = buildDeck({ lang: "es", source: [src("casa"), src("mesa")], manifest: empty(), prev: null, newBody: ids });
  const b = buildDeck({ lang: "es", source: [src("casa")], manifest: a.manifest, prev: a.deck, newBody: ids });
  const c = buildDeck({ lang: "es", source: [src("casa"), src("mesa")], manifest: b.manifest, prev: b.deck, newBody: ids });
  expect(c.errors).toEqual([]);
  const mesas = c.deck.words.filter((w) => w.lemma === "mesa");
  expect(mesas.map((w) => !!w.retired).sort()).toEqual([false, true]);
  expect(new Set(mesas.map((w) => w.id)).size).toBe(2);
  expect(compatibility(b.deck, c.deck).errors).toEqual([]);
});

test("aliases from aliases.json", () => {
  const ids = counter();
  const a = buildDeck({ lang: "es", source: [src("casa"), src("hogar")], manifest: empty(), prev: null, newBody: ids });
  const [casa, hogar] = a.deck.words;
  const b = buildDeck({ lang: "es", source: [src("casa")], manifest: a.manifest, prev: a.deck, aliases: { [hogar.id]: casa.id }, newBody: ids });
  expect(b.errors).toEqual([]);
  expect(b.deck.words[1]).toMatchObject({ id: hogar.id, retired: true, aliasOf: casa.id });
  expect(compatibility(a.deck, b.deck)).toMatchObject({ errors: [], retired: 0 });
  const bad = buildDeck({ lang: "es", source: [src("casa")], manifest: a.manifest, prev: a.deck, aliases: { "es.w.zzzzzzzzzz": casa.id }, newBody: ids });
  expect(bad.errors.join()).toMatch(/unknown word/);
});

test("duplicates and invalid content are errors", () => {
  const dup = buildDeck({ lang: "es", source: [src("casa"), src("Casa")], manifest: empty(), prev: null, newBody: counter() });
  expect(dup.errors.join()).toMatch(/duplicate of an earlier word/);
  const senses = buildDeck({ lang: "es", source: [src("banco"), src("banco", { sense: "bench" })], manifest: empty(), prev: null, newBody: counter() });
  expect(senses.errors).toEqual([]);
  const badBase = src("casa");
  const bad = { ...badBase, sentences: badBase.sentences.map((s, i) => (i === 1 ? { ...s, cloze: "perro" } : s)) };
  expect(buildDeck({ lang: "es", source: [bad], manifest: empty(), prev: null, newBody: counter() }).errors.join()).toMatch(/is not in/);
});

test("garden.json marks deck words; a missing, retired or doubly named word, or a thing named twice, is an error", () => {
  const build = (source: SourceWord[], garden: Garden, prev: { deck: Deck; manifest: Manifest } | null = null) =>
    buildDeck({ lang: "es", source, manifest: prev?.manifest ?? empty(), prev: prev?.deck ?? null, garden, newBody: counter() });
  const ok = build([src("gata"), src("casa")], [{ garden: "cat", word: "gata|noun" }]);
  expect(ok.errors).toEqual([]);
  expect(ok.deck.words.map((w) => w.garden)).toEqual(["cat", undefined]);

  expect(build([src("casa")], [{ garden: "cat", word: "gata|noun" }]).errors).toEqual(['garden.json: "gata|noun" (cat) is not a live word in the source']);
  // gata left the source: retired, so it can't bring the cat.
  expect(build([src("casa")], [{ garden: "cat", word: "gata|noun" }], ok).errors).toEqual(['garden.json: "gata|noun" (cat) is not a live word in the source']);
  // ... and once it leaves the garden file too, the retired word brings nothing.
  const retired = build([src("casa")], [], ok);
  expect(retired.errors).toEqual([]);
  expect(retired.deck.words.find((w) => w.lemma === "gata")).toMatchObject({ retired: true, garden: undefined });
  expect(build([src("gata")], [{ garden: "cat", word: "gata|noun" }, { garden: "bird", word: "gata|noun" }]).errors).toEqual(['garden.json: "gata|noun" is named for both "cat" and "bird"']);
  expect(build([src("gata"), src("michi")], [{ garden: "cat", word: "gata|noun" }, { garden: "cat", word: "michi|noun" }]).errors).toEqual(['two live words bring the garden "cat"']);
});

test("orchard.json marks deck words like garden.json; a word names one thing, a tree is planted once", () => {
  const build = (source: SourceWord[], orchard: Orchard, garden: Garden = []) => buildDeck({ lang: "es", source, manifest: empty(), prev: null, garden, orchard, newBody: counter() });
  const ok = build([src("manzana"), src("casa")], [{ orchard: "apple", word: "manzana|noun" }]);
  expect(ok.errors).toEqual([]);
  expect(ok.deck.words.map((w) => w.orchard)).toEqual(["apple", undefined]);
  expect(build([src("casa")], [{ orchard: "apple", word: "manzana|noun" }]).errors).toEqual(['orchard.json: "manzana|noun" (apple) is not a live word in the source']);
  expect(build([src("gata")], [{ orchard: "tree", word: "gata|noun" }], [{ garden: "cat", word: "gata|noun" }]).errors).toEqual(['orchard.json: "gata|noun" is named for both "cat" and "tree"']);
  expect(build([src("manzana"), src("poma")], [{ orchard: "apple", word: "manzana|noun" }, { orchard: "apple", word: "poma|noun" }]).errors).toEqual(['two live words plant the orchard "apple"']);
});

test("warnings: ambiguous clozes and a single repeated form", () => {
  const w = src("a", {
    pos: "prep",
    forms: ["a", "al"],
    gender: undefined,
    sentences: [
      { text: "Voy a la casa a las ocho.", translation: "x", cloze: "a" },
      { text: "Voy a casa.", translation: "x", cloze: "a" },
      { text: "Llego a tiempo.", translation: "x", cloze: "a" },
    ],
  });
  const r = buildDeck({ lang: "es", source: [w], manifest: empty(), prev: null, newBody: counter() });
  expect(r.warnings.join("\n")).toMatch(/occurs 2× as a whole word/);
  expect(r.warnings.join("\n")).toMatch(/vary the forms/);
});

test("wholeWordCount is Unicode aware", () => {
  expect(wholeWordCount("Voy a la playa.", "a")).toBe(1);
  expect(wholeWordCount("¿Qué es esto?", "es")).toBe(1);
  expect(wholeWordCount("Ich weiß, dass du müde bist.", "dass")).toBe(1);
  expect(wholeWordCount("Él está aquí.", "está")).toBe(1);
  expect(wholeWordCount("Ella está aquí.", "est")).toBe(0);
});

test("wordCount ignores spaces at the ends and doubled spaces", () => {
  expect(wordCount(" Hola, ¿qué tal? ")).toBe(3);
  expect(wordCount("uno  dos")).toBe(2);
});
