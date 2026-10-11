import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VISITORS, STRIP_VISITORS } from "./visitors";
import {
  boardBox,
  DECOR_KINDS,
  hillTopY,
  pickScenery,
  rayBox,
  rayCloud,
  rayDisc,
  rayHills,
  SCENERY,
  sceneryLemma,
  sceneryViews,
  spriteBox,
  TREE_KINDS,
  type HillRing,
  type Ray,
  type SceneryId,
  type SceneryWorld,
} from "./scenery";

const ids = Object.keys(SCENERY) as SceneryId[];
const deckLemmas = (lang: string) =>
  new Set((JSON.parse(readFileSync(join(import.meta.dir, `../../../decks/${lang}/deck.json`), "utf8")) as { words: { lemma: string; pos: string }[] }).words.filter((w) => w.pos === "noun").map((w) => w.lemma));

describe("scenery words", () => {
  test("every entry has a Spanish and a German word with its article, and a plain gloss", () => {
    for (const id of ids) {
      const d = SCENERY[id];
      expect(d.words.es).toMatch(/^(el|la|los|las) \p{L}+$/u);
      expect(d.words.de).toMatch(/^(der|die|das) \p{Lu}\p{L}+$/u);
      expect(d.gloss).toMatch(/^[a-z]+( [a-z]+)?$/);
    }
  });

  test("no duplicates, and no word a visitor already has", () => {
    const visitorWords = [...VISITORS.map((v) => v.words), ...Object.values(STRIP_VISITORS).map((v) => v.words)];
    for (const lang of ["es", "de"]) {
      const words = ids.map((id) => SCENERY[id].words[lang]);
      expect(new Set(words).size).toBe(words.length);
      for (const w of visitorWords) expect(words).not.toContain(w[lang]);
    }
    const glosses = ids.map((id) => SCENERY[id].gloss);
    expect(new Set(glosses).size).toBe(glosses.length);
  });

  test("the lemma is the noun after the article, or the singular for a plural", () => {
    expect(sceneryLemma("sunflower", "es")).toBe("girasol");
    expect(sceneryLemma("cherry", "de")).toBe("Kirschbaum");
    expect(sceneryLemma("hills", "es")).toBe("colina");
    expect(sceneryLemma("sun", "fr")).toBeNull();
  });

  test("the deck words among them are the ones we expect (they get the known leaf once known)", () => {
    const inDeck = (lang: string) => {
      const deck = deckLemmas(lang);
      return ids.filter((id) => deck.has(sceneryLemma(id, lang)!)).sort();
    };
    expect(inDeck("es")).toEqual(["bench", "flower", "gate", "moon", "path", "sky", "stone", "sun", "tree"]);
    expect(inDeck("de")).toEqual(["bench", "flower", "sky", "sun"]);
  });

  test("known marking: by lemma, like visitors; a course without words has none", () => {
    const known = new Set(["sol", "árbol", "colina"]);
    const v = sceneryViews("es", (l) => known.has(l));
    expect(v.sun).toEqual({ id: "sun", word: "el sol", gloss: "sun", known: true });
    expect(v.tree!.known).toBe(true);
    expect(v.hills!.known).toBe(true);
    expect(v.sunflower!.known).toBe(false);
    expect(Object.keys(v)).toHaveLength(ids.length);
    expect(sceneryViews("fr")).toEqual({});
    expect(Object.values(sceneryViews("de")).every((x) => !x!.known)).toBe(true);
  });

  test("every tree and decor kind names a scenery word", () => {
    for (const k of [...TREE_KINDS, ...DECOR_KINDS]) if (k) expect(SCENERY[k.id]).toBeDefined();
  });
});

const ray = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): Ray => {
  const l = Math.hypot(dx, dy, dz);
  return { ox, oy, oz, dx: dx / l, dy: dy / l, dz: dz / l };
};

describe("hit tests", () => {
  test("ray and box", () => {
    expect(rayBox(ray(0, 1, 0, 0, 0, -1), [-1, 0, -6], [1, 2, -4])).toBeCloseTo(4);
    expect(rayBox(ray(0, 1, 0, 0, 0, 1), [-1, 0, -6], [1, 2, -4])).toBe(Infinity);
    expect(rayBox(ray(0, 3, 0, 0, 0, -1), [-1, 0, -6], [1, 2, -4])).toBe(Infinity);
  });

  test("ray and disc, ray and cloud", () => {
    expect(rayDisc(ray(0, 1, 0, 0, -1, -1), 0, 0, -1, 0.3)).toBeCloseTo(Math.SQRT2);
    expect(rayDisc(ray(0, 1, 0, 0, -1, -1), 0, 0, -3, 0.3)).toBe(Infinity);
    expect(rayDisc(ray(0, 1, 0, 0, 1, -1), 0, 0, -1, 0.3)).toBe(Infinity);
    // A cloud due north (-z), 130 m away and 50 m up.
    expect(rayCloud(ray(0, 1, 0, 0, 49, -130), 0, 50, -130, 9, 5)).toBeLessThan(Infinity);
    expect(rayCloud(ray(0, 1, 0, 20, 49, -130), 0, 50, -130, 9, 5)).toBe(Infinity);
  });

  test("the hills: under the ridge yes, over it no", () => {
    const h: HillRing = { radius: 150, bottom: -7, top: 27, profile: Array(256).fill(32), rows: 64, repeat: 4 };
    expect(hillTopY(h, 1.2)).toBeCloseTo(10);
    expect(rayHills(ray(0, 1, 0, 0, 0.02, -1), h)).not.toBeNull();
    expect(rayHills(ray(0, 1, 0, 0, 0.2, -1), h)).toBeNull();
  });

  test("boxes from sprites and boards: tags sit above them, small things stay tappable", () => {
    const s = spriteBox("stone", 1, 0, 2, 0.05, 0.04);
    expect(s.max[0] - s.min[0]).toBeCloseTo(0.24);
    expect(s.tag![1]).toBeGreaterThan(s.max[1]);
    const b = boardBox(0, 0, 1.2, 1.19, 0);
    expect(b.max[0]).toBeCloseTo(0.6);
    expect(b.tag![1]).toBeGreaterThan(1.19);
  });

  test("a turned board is hit where it is, not where its unturned box would be", () => {
    // Turned a quarter round: it now runs along z, 1.2 m long and thin in x.
    const b = boardBox(0, -3, 1.2, 1, Math.PI / 2);
    const w = (r: Ray) => pickScenery(r, { boxes: [b], discs: [], bounds: { minX: -9, maxX: 9, minZ: -9, maxZ: 9 }, far: 46, hills: { radius: 150, bottom: -7, top: 27, profile: [0], rows: 64, repeat: 4 }, sunDir: { x: 0, y: -1, z: 0 }, night: false, sunRadius: 0.01, clouds: [], cloudHalf: [1, 1] }, (id) => id === "sign");
    expect(w(ray(0.4, 0.5, 0, 0, 0, -1))).toBeNull();
    expect(w(ray(0, 0.5, 0, 0, 0, -1))!.id).toBe("sign");
    expect(w(ray(-3, 0.5, -3.5, 1, 0, 0))!.id).toBe("sign");
  });
});

describe("pickScenery", () => {
  const world = (over: Partial<SceneryWorld> = {}): SceneryWorld => ({
    boxes: [spriteBox("sunflower", 0, 0, -5, 0.25, 1.6), { id: "fence", min: [-10, 0, -8.05], max: [10, 0.8, -7.95], tag: null }, spriteBox("tree", 0, 0, -12, 1, 4)],
    discs: [{ id: "pond", x: 4, y: 0.04, z: 0, r: 1, tagY: 0.3 }],
    bounds: { minX: -10, maxX: 10, minZ: -8, maxZ: 8 },
    far: 46,
    hills: { radius: 150, bottom: -7, top: 27, profile: Array(256).fill(32), rows: 64, repeat: 4 },
    sunDir: { x: 0, y: Math.SQRT1_2, z: Math.SQRT1_2 },
    night: false,
    sunRadius: 0.045,
    clouds: [{ x: -130, y: 50, z: 0 }],
    cloudHalf: [8.8, 5],
    ...over,
  });
  const eye = (dx: number, dy: number, dz: number) => ray(0, 1, 0, dx, dy, dz);

  test("the nearest thing wins, and its tag sits over it", () => {
    const hit = pickScenery(eye(0, 0, -1), world())!;
    expect(hit.id).toBe("sunflower");
    expect(hit.y).toBeGreaterThan(1.6);
    // Over the sunflower's head: the fence, then a tree beyond it.
    expect(pickScenery(eye(0, -0.3 / 8, -1), world({ boxes: world().boxes.slice(1) }))!.id).toBe("fence");
    expect(pickScenery(eye(0, 0.15, -1), world())!.id).toBe("tree");
  });

  test("a long thing's tag sits where you tapped it", () => {
    const hit = pickScenery(eye(2, -0.3, -8), world({ boxes: world().boxes.slice(1, 2) }))!;
    expect(hit.id).toBe("fence");
    expect(hit.x).toBeCloseTo(2, 0);
    expect(hit.y).toBeCloseTo(0.85);
  });

  test("the ground is path inside the fence and grass outside; the pond is the pond", () => {
    expect(pickScenery(eye(1, -1, 0), world())!.id).toBe("path");
    expect(pickScenery(eye(4, -1, 0), world())!.id).toBe("pond");
    expect(pickScenery(eye(12, -1, 0), world())!.id).toBe("grass");
  });

  test("the sky: the sun by day, the moon at night, a cloud, the hills, and the sky itself", () => {
    expect(pickScenery(eye(0, 1, 1), world())).toMatchObject({ id: "sun", follow: "sun" });
    expect(pickScenery(eye(0, 1, 1), world({ night: true }))!.id).toBe("moon");
    expect(pickScenery(eye(-130, 49, 0), world())).toMatchObject({ id: "cloud", follow: { cloud: 0 } });
    expect(pickScenery(eye(1, 0.02, 0), world())!.id).toBe("hills");
    expect(pickScenery(eye(1, 0.6, 0.3), world())!.id).toBe("sky");
  });

  test("things this course has no word for are passed over", () => {
    expect(pickScenery(eye(0, -0.03, -1), world(), (id) => id !== "sunflower")!.id).toBe("fence");
    expect(pickScenery(eye(0, 0, -1), world(), () => false)).toBeNull();
  });
});
