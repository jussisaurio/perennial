// What a creature from the pot (#387) is called: a tiny grammar in the course
// language, nominative only. The indefinite article and the noun, then the
// trait: a "con …"/"mit …" phrase, or an adjective that agrees with the noun
// ("una rana orejuda", "eine grüne Katze"). A little one (two seeds of one
// kind) is a diminutive in Spanish ("un gatito") and "klein" in German ("eine
// kleine Katze"). A few joke pairs per language say something of their own.
// NATIVE-SPEAKER CHECK: every phrase and joke here (#387). Pure.

import { isDeckLang, type DeckLang } from "../deck/schema";
import { inLang, type PerLang } from "./nouns";
import { traitOf, type Creature, type PotKind, type Trait } from "./pot";

/** A noun and its gender (each one here is masculine or feminine). */
interface Noun {
  noun: string;
  g: "m" | "f";
}

const NOUNS: { es: Record<PotKind, Noun & { little: Noun }>; de: Record<PotKind, Noun> } = {
  es: {
    cat: { noun: "gato", g: "m", little: { noun: "gatito", g: "m" } },
    bird: { noun: "pájaro", g: "m", little: { noun: "pajarito", g: "m" } },
    dog: { noun: "perro", g: "m", little: { noun: "perrito", g: "m" } },
    fish: { noun: "pez", g: "m", little: { noun: "pececito", g: "m" } },
    butterfly: { noun: "mariposa", g: "f", little: { noun: "mariposita", g: "f" } },
    frog: { noun: "rana", g: "f", little: { noun: "ranita", g: "f" } },
    snail: { noun: "caracol", g: "m", little: { noun: "caracolito", g: "m" } },
  },
  de: {
    cat: { noun: "Katze", g: "f" },
    bird: { noun: "Vogel", g: "m" },
    dog: { noun: "Hund", g: "m" },
    fish: { noun: "Fisch", g: "m" },
    butterfly: { noun: "Schmetterling", g: "m" },
    frog: { noun: "Frosch", g: "m" },
    snail: { noun: "Schnecke", g: "f" },
  },
};

/** A trait in words: a phrase after the noun, or an adjective (Spanish: after the noun, by gender; German: a stem before it, with the ending after "ein"). */
const PHRASES: { es: Record<Trait, { with: string } | { adj: Record<"m" | "f", string> }>; de: Record<Trait, { with: string } | { stem: string }> } = {
  es: {
    whiskers: { with: "con bigotes" },
    wings: { with: "con alas" },
    ears: { adj: { m: "orejudo", f: "orejuda" } },
    fins: { with: "con aletas" },
    antennae: { with: "con antenas" },
    green: { adj: { m: "verde", f: "verde" } },
    shell: { with: "con concha" },
  },
  de: {
    whiskers: { with: "mit Schnurrhaaren" },
    wings: { with: "mit Flügeln" },
    ears: { with: "mit Schlappohren" },
    fins: { with: "mit Flossen" },
    antennae: { with: "mit Fühlern" },
    green: { stem: "grün" },
    shell: { with: "mit Schneckenhaus" },
  },
};

/** The English, for the gloss and the screen reader's line: "a cat with wings", "a green cat". */
const GLOSS_NOUN: Record<PotKind, string> = { cat: "cat", bird: "bird", dog: "dog", fish: "fish", butterfly: "butterfly", frog: "frog", snail: "snail" };
const GLOSS_LITTLE: Record<PotKind, string> = { cat: "kitten", bird: "little bird", dog: "puppy", fish: "little fish", butterfly: "little butterfly", frog: "little frog", snail: "little snail" };
const GLOSS_TRAIT: Record<Trait, string> = {
  whiskers: "with whiskers",
  wings: "with wings",
  ears: "with floppy ears",
  fins: "with fins",
  antennae: "with antennae",
  green: "green",
  shell: "with a shell",
};

/** A joke pair: it may have a name of its own, and it says a line when tapped. */
interface Joke {
  base: PotKind;
  trait: PotKind;
  name?: string;
  gloss?: string;
  says: string;
}

/** About five per language. NATIVE-SPEAKER CHECK. */
const JOKES: PerLang<readonly Joke[]> = {
  es: [
    // "When frogs grow hair": when pigs fly.
    { base: "frog", trait: "cat", name: "una rana con pelo", gloss: "a frog with hair", says: "¡Cuando las ranas críen pelo!" },
    // A flying fish is a real fish.
    { base: "fish", trait: "bird", name: "un pez volador", gloss: "a flying fish", says: "¡Soy de verdad!" },
    // "Like the dog and the cat": they never get on.
    { base: "cat", trait: "dog", says: "Como el perro y el gato." },
    // "Like a fish in water": quite at home.
    { base: "dog", trait: "fish", says: "Como pez en el agua." },
    // "At a snail's pace": slowly.
    { base: "snail", trait: "bird", says: "¡Adiós, paso de caracol!" },
  ],
  de: [
    // "A frog in the throat": a croaky voice.
    { base: "cat", trait: "frog", says: "Ich habe einen Frosch im Hals." },
    // "Like dog and cat": they never get on.
    { base: "cat", trait: "dog", says: "Wie Hund und Katze." },
    // "Butterflies in the belly": in love.
    { base: "frog", trait: "butterfly", says: "Schmetterlinge im Bauch!" },
    // A flying fish is a real fish.
    { base: "fish", trait: "bird", name: "ein fliegender Fisch", gloss: "a flying fish", says: "Mich gibt es wirklich!" },
    // "Like a fish in water": quite at home.
    { base: "dog", trait: "fish", says: "Wie ein Fisch im Wasser." },
  ],
};

const ES_ARTICLE = { m: "un", f: "una" };
const DE_ARTICLE = { m: "ein", f: "eine" };
/** An adjective's ending after "ein"/"eine", in the nominative. */
const DE_ENDING = { m: "er", f: "e" };

/** A creature's name in the course language: what it is called (null for a course with no words for it), its English gloss, and the joke it says, if any. */
export interface CreatureName {
  word: string | null;
  gloss: string;
  says: string | null;
}

/** The name in a course's grammar. */
function named(c: Creature, lang: DeckLang): string {
  const trait = traitOf(c);
  if (lang === "es") {
    const n = NOUNS.es[c.base];
    if (!trait) return `${ES_ARTICLE[n.little.g]} ${n.little.noun}`;
    const p = PHRASES.es[trait];
    return `${ES_ARTICLE[n.g]} ${n.noun} ${"with" in p ? p.with : p.adj[n.g]}`;
  }
  const n = NOUNS.de[c.base];
  const p = trait ? PHRASES.de[trait] : { stem: "klein" };
  return "stem" in p ? `${DE_ARTICLE[n.g]} ${p.stem}${DE_ENDING[n.g]} ${n.noun}` : `${DE_ARTICLE[n.g]} ${n.noun} ${p.with}`;
}

export function creatureName(c: Creature, lang: string): CreatureName {
  const trait = traitOf(c);
  const plain = trait ? (trait === "green" ? `a green ${GLOSS_NOUN[c.base]}` : `a ${GLOSS_NOUN[c.base]} ${GLOSS_TRAIT[trait]}`) : `a ${GLOSS_LITTLE[c.base]}`;
  const joke = inLang(JOKES, lang)?.find((j) => j.base === c.base && j.trait === c.trait);
  const word = isDeckLang(lang) ? named(c, lang) : null;
  return { word: joke?.name ?? word, gloss: joke?.gloss ?? plain, says: joke?.says ?? null };
}
