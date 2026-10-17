import { describe, expect, test } from "bun:test";
import { MAX_PETALS, petalAt, petalForms, plantInReach, SHAKE, SHAKE_REACH, shakeLength, shiver } from "./shake";

describe("shaking a plant (#357)", () => {
  test("its other forms fall, in the deck's order, each once, never the word itself", () => {
    expect(petalForms("Mann", ["Mann", "Mannes", "Männer", "Männern"])).toEqual(["Mannes", "Männer", "Männern"]);
    expect(petalForms("gato", ["gato", "gata", "gatos", "Gatos"])).toEqual(["gata", "gatos"]);
  });

  test("a word with no other forms drops nothing but its leaf", () => {
    expect(petalForms("y", ["y"])).toEqual([]);
    // A learner's own word has only its lemma, lowercased.
    expect(petalForms("Hund", ["hund"])).toEqual([]);
  });

  test("a big verb sheds a handful, not all sixteen", () => {
    const ser = ["ser", "soy", "eres", "es", "somos", "sois", "son", "era", "eras", "éramos", "eran", "fui", "fue", "fueron", "sido", "sea"];
    expect(petalForms("ser", ser)).toEqual(ser.slice(1, 1 + MAX_PETALS));
  });

  test("the plant shivers, then stands still", () => {
    expect(Math.abs(shiver(0.05))).toBeGreaterThan(0.01);
    expect(shiver(SHAKE.shiver + 0.01)).toBe(0);
  });

  test("a petal falls from the top to the soil, lies there, fades, and is gone", () => {
    const n = 3;
    const end = shakeLength(n);
    // The last petal starts after the others.
    expect(petalAt("w1", 2, SHAKE.gap, 0.8, false)).toBeNull();
    const start = petalAt("w1", 0, 0, 0.8, false)!;
    expect(start.dy).toBeCloseTo(0);
    const landed = petalAt("w1", 0, SHAKE.fall + 0.1, 0.8, false)!;
    expect(landed.dy).toBeCloseTo(-0.8);
    expect(landed.alpha).toBe(1);
    const fading = petalAt("w1", 0, SHAKE.fall + SHAKE.rest + SHAKE.fade / 2, 0.8, false)!;
    expect(fading.alpha).toBeCloseTo(0.5);
    expect(petalAt("w1", n - 1, end + 0.01, 0.8, false)).toBeNull();
    expect(petalAt("w1", n - 1, end - 0.01, 0.8, false)).not.toBeNull();
  });

  test("each petal drifts its own way, the same way every time", () => {
    const a = petalAt("w1", 0, 1, 0.8, false)!;
    const b = petalAt("w1", 1, 1 + SHAKE.gap, 0.8, false)!;
    expect([a.dx, a.dz]).not.toEqual([b.dx, b.dz]);
    expect(petalAt("w1", 0, 1, 0.8, false)).toEqual(a);
  });

  test("with reduced motion a petal lies on the soil from the start", () => {
    expect(petalAt("w1", 0, 0, 0.8, true)!.dy).toBeCloseTo(-0.8);
  });

  test("the plant in reach is the one ahead of you, nearest the middle of the view", () => {
    const plants = [
      { id: "behind", x: 0, z: 0.5 },
      { id: "aside", x: 0.6, z: -0.9 },
      { id: "ahead", x: 0, z: -1.6 },
      { id: "farther", x: 0, z: -2 },
      { id: "far", x: 0, z: -SHAKE_REACH - 0.1 },
    ];
    // Facing -z (yaw 0).
    expect(plantInReach(plants, 0, 0, 0)?.id).toBe("ahead");
    // Facing +z: only the one behind is ahead now.
    expect(plantInReach(plants, 0, 0, Math.PI)?.id).toBe("behind");
    // Facing -x: nothing there.
    expect(plantInReach(plants, 0, 0, Math.PI / 2)).toBeNull();
  });
});
