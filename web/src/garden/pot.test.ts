import { describe, expect, test } from "bun:test";
import { NO_POT, POT_LIMITS } from "perennial-contract";
import { letOut, potAt, potNow, POT_KINDS, seedOf, sow, takes, TRAITS, traitOf, wandering, WANDER, type Creature, type Pot } from "./pot";
import { creatureArt, POT, seedArt } from "./potArt";
import { creatureName } from "./potNames";
import { collide, layout, type GardenPlant } from "./world";

// A fixed calendar day (core/day.ts dayNumber), so nothing here reads the clock.
const DAY = 20_600;

const pair = (pot: Pot, a: (typeof POT_KINDS)[number], b: (typeof POT_KINDS)[number], day = DAY) => sow(sow(pot, a, day), b, day);

describe("the traits", () => {
  test("each kind gives its own one, and two seeds of one kind give none: a little one", () => {
    expect(TRAITS).toEqual({ cat: "whiskers", bird: "wings", dog: "ears", fish: "fins", butterfly: "antennae", frog: "green", snail: "shell" });
    expect(new Set(Object.values(TRAITS)).size).toBe(POT_KINDS.length);
    expect(traitOf({ base: "cat", trait: "bird" })).toBe("wings");
    expect(traitOf({ base: "cat", trait: "cat" })).toBeNull();
  });

  test("only the drawn visitors' plants give seeds", () => {
    expect(seedOf({ garden: "cat" })).toBe("cat");
    expect(seedOf({ garden: "key" })).toBeNull();
    expect(seedOf({})).toBeNull();
  });
});

describe("the pot, night by night", () => {
  test("two seeds hatch in the night after the second went in, and wait to be let out", () => {
    const one = sow(NO_POT, "cat", DAY);
    expect(potNow(one, DAY)).toEqual({ kind: "seeds", seeds: ["cat"] });
    // One seed never hatches, however long it waits.
    expect(potNow(one, DAY + 30).kind).toBe("seeds");
    expect(takes(one)).toBe(true);
    // The second on the next day: the night after that one counts.
    const two = sow(one, "bird", DAY + 1);
    expect(two).toMatchObject({ sown: 2, out: 0, seeds: ["cat", "bird"], day: DAY + 1 });
    expect(takes(two)).toBe(false);
    expect(potNow(two, DAY + 1)).toEqual({ kind: "seeds", seeds: ["cat", "bird"] });
    expect(potNow(two, DAY + 2)).toEqual({ kind: "hatched", creature: { base: "cat", trait: "bird" } });
    // Weeks later it still waits, the same.
    expect(potNow(two, DAY + 40)).toEqual({ kind: "hatched", creature: { base: "cat", trait: "bird" } });
  });

  test("let out, it joins the creatures and the pot is empty: one creature a night", () => {
    const out = letOut(pair(NO_POT, "cat", "bird"), { base: "cat", trait: "bird" });
    expect(out).toEqual({ sown: 2, out: 1, seeds: [], day: null, hatched: [{ base: "cat", trait: "bird" }] });
    expect(potNow(out, DAY + 1).kind).toBe("empty");
    // Sown again the same day, the next one hatches only after another night.
    const again = pair(out, "frog", "dog", DAY + 1);
    expect(potNow(again, DAY + 1).kind).toBe("seeds");
    expect(potNow(again, DAY + 2)).toEqual({ kind: "hatched", creature: { base: "frog", trait: "dog" } });
  });

  test("at most WANDER wander, the newest; every one is kept, up to the limit", () => {
    let pot: Pot = NO_POT;
    const made: Creature[] = POT_KINDS.map((k) => ({ base: k, trait: "bird" }));
    for (const c of made) pot = letOut(pair(pot, c.base, c.trait), c);
    expect(pot.out).toBe(POT_KINDS.length);
    expect(pot.hatched).toEqual(made);
    expect(wandering(pot)).toEqual(made.slice(-WANDER));
    for (let i = 0; i < POT_LIMITS.hatched; i++) pot = letOut(pair(pot, "dog", "dog"), { base: "dog", trait: "dog" });
    expect(pot.hatched.length).toBe(POT_LIMITS.hatched);
    expect(pot.out).toBe(POT_KINDS.length + POT_LIMITS.hatched);
  });

  test("the pot stands on open ground by the shed, in a small garden and a big one", () => {
    const plant = (i: number): GardenPlant => ({ id: `w${i}`, lemma: `w${i}`, gloss: "", pos: i % 3 ? "noun" : "verb", rank: i, s: 10, r: 0.95, stage: "bloom", growth: 0.5, listen: false, write: false });
    for (const n of [0, 3, 40, 300]) {
      const L = layout(Array.from({ length: n }, (_, i) => plant(i)));
      const p = potAt(L);
      // Nothing pushes it: not in a bed, the pond or over the fence.
      expect(collide(L, p.x, p.z, 0.2)).toEqual(p);
    }
  });
});

// Every base with every trait (rows: bases; columns: what the second seed gives), in POT_KINDS order: cat, bird, dog, fish, butterfly, frog, snail.
const ES: Record<(typeof POT_KINDS)[number], string[]> = {
  cat: ["un gatito", "un gato con alas", "un gato orejudo", "un gato con aletas", "un gato con antenas", "un gato verde", "un gato con concha"],
  bird: ["un pájaro con bigotes", "un pajarito", "un pájaro orejudo", "un pájaro con aletas", "un pájaro con antenas", "un pájaro verde", "un pájaro con concha"],
  dog: ["un perro con bigotes", "un perro con alas", "un perrito", "un perro con aletas", "un perro con antenas", "un perro verde", "un perro con concha"],
  fish: ["un pez con bigotes", "un pez volador", "un pez orejudo", "un pececito", "un pez con antenas", "un pez verde", "un pez con concha"],
  butterfly: ["una mariposa con bigotes", "una mariposa con alas", "una mariposa orejuda", "una mariposa con aletas", "una mariposita", "una mariposa verde", "una mariposa con concha"],
  frog: ["una rana con pelo", "una rana con alas", "una rana orejuda", "una rana con aletas", "una rana con antenas", "una ranita", "una rana con concha"],
  snail: ["un caracol con bigotes", "un caracol con alas", "un caracol orejudo", "un caracol con aletas", "un caracol con antenas", "un caracol verde", "un caracolito"],
};
const DE: Record<(typeof POT_KINDS)[number], string[]> = {
  cat: ["eine kleine Katze", "eine Katze mit Flügeln", "eine Katze mit Schlappohren", "eine Katze mit Flossen", "eine Katze mit Fühlern", "eine grüne Katze", "eine Katze mit Schneckenhaus"],
  bird: ["ein Vogel mit Schnurrhaaren", "ein kleiner Vogel", "ein Vogel mit Schlappohren", "ein Vogel mit Flossen", "ein Vogel mit Fühlern", "ein grüner Vogel", "ein Vogel mit Schneckenhaus"],
  dog: ["ein Hund mit Schnurrhaaren", "ein Hund mit Flügeln", "ein kleiner Hund", "ein Hund mit Flossen", "ein Hund mit Fühlern", "ein grüner Hund", "ein Hund mit Schneckenhaus"],
  fish: ["ein Fisch mit Schnurrhaaren", "ein fliegender Fisch", "ein Fisch mit Schlappohren", "ein kleiner Fisch", "ein Fisch mit Fühlern", "ein grüner Fisch", "ein Fisch mit Schneckenhaus"],
  butterfly: [
    "ein Schmetterling mit Schnurrhaaren",
    "ein Schmetterling mit Flügeln",
    "ein Schmetterling mit Schlappohren",
    "ein Schmetterling mit Flossen",
    "ein kleiner Schmetterling",
    "ein grüner Schmetterling",
    "ein Schmetterling mit Schneckenhaus",
  ],
  frog: ["ein Frosch mit Schnurrhaaren", "ein Frosch mit Flügeln", "ein Frosch mit Schlappohren", "ein Frosch mit Flossen", "ein Frosch mit Fühlern", "ein kleiner Frosch", "ein Frosch mit Schneckenhaus"],
  snail: ["eine Schnecke mit Schnurrhaaren", "eine Schnecke mit Flügeln", "eine Schnecke mit Schlappohren", "eine Schnecke mit Flossen", "eine Schnecke mit Fühlern", "eine grüne Schnecke", "eine kleine Schnecke"],
};

describe("names", () => {
  test("every base with every trait, in Spanish and German, agreeing with the noun", () => {
    for (const base of POT_KINDS) {
      expect(POT_KINDS.map((trait) => creatureName({ base, trait }, "es").word)).toEqual(ES[base]);
      expect(POT_KINDS.map((trait) => creatureName({ base, trait }, "de").word)).toEqual(DE[base]);
    }
  });

  test("the English says what it is; a joke pair says its line", () => {
    expect(creatureName({ base: "cat", trait: "bird" }, "es")).toEqual({ word: "un gato con alas", gloss: "a cat with wings", says: null });
    expect(creatureName({ base: "cat", trait: "frog" }, "es").gloss).toBe("a green cat");
    expect(creatureName({ base: "cat", trait: "cat" }, "de").gloss).toBe("a kitten");
    expect(creatureName({ base: "frog", trait: "cat" }, "es")).toEqual({ word: "una rana con pelo", gloss: "a frog with hair", says: "¡Cuando las ranas críen pelo!" });
    expect(creatureName({ base: "cat", trait: "frog" }, "de").says).toBe("Ich habe einen Frosch im Hals.");
    // A course with no words for it: the meaning only.
    expect(creatureName({ base: "cat", trait: "bird" }, "fr")).toEqual({ word: null, gloss: "a cat with wings", says: null });
  });
});

describe("art", () => {
  const pixels = (rows: string[]) => rows.join("").replace(/\./g, "").length;

  test("a creature is its base with its trait drawn on: more pixels, or (green) other colours", () => {
    for (const base of POT_KINDS) {
      const little = creatureArt({ base, trait: base });
      expect(little.rows.length).toBe(32);
      expect(little.rows.every((r) => r.length === 32)).toBe(true);
      for (const trait of POT_KINDS) {
        if (trait === base) continue;
        const art = creatureArt({ base, trait });
        if (TRAITS[trait] === "green") expect(Object.values(art.pal).sort()).not.toEqual(Object.values(little.pal).sort());
        else expect(pixels(art.rows)).toBeGreaterThan(pixels(little.rows));
      }
    }
  });

  test("seeds and the pot fit their cells", () => {
    for (const k of POT_KINDS) expect(seedArt(k).rows[0].length).toBeLessThanOrEqual(32);
    expect(POT.rows.length).toBeLessThanOrEqual(32);
  });
});
