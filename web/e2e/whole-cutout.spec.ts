import type { Body, VisitorKind } from "../src/garden/kinds/kind";
import type { HitBox } from "../src/garden/scenery";
import { pinDetail } from "./helpers";
import { openWalkBuilt, TIMES } from "./spots";
import { expect, test } from "./test";

// render.whole-cutout (docs/invariants.md): a visitor at rest is drawn whole from every side.
// It reads the scene's own tap volumes and each visitor's place (wholeCutout.ts), with every
// visitor in the garden, and the places by you on the bench where the bird, the cat and the gnome sit.

/** The scene's parts this test reads. They are private to the scene, so the test casts to reach them, as drawn-solid.spec.ts does. */
type Drawn = {
  hitBoxes: HitBox[];
  guests: { sprites: { kind: VisitorKind; size: number; home: [number, number, number]; body: Body<string> }[] };
};

test("render.whole-cutout: no solid thing cuts a visitor at rest, from any side, nor one sitting with you on the bench", async ({ page }) => {
  // Where each visitor is depends on the day: on this one the cat sleeps on the bench.
  await page.clock.setFixedTime(TIMES.day);
  // Built is enough: every tap volume and visitor is in by then (drawn-solid.spec.ts).
  // Low detail: a walk starts at normal, whose warm-up draws the shadow pass too (#1174). On CI's software WebGL
  // that is slow, and it took time from the tests beside it (#1177).
  await pinDetail(page, "low");
  await openWalkBuilt(page, "es:800", "as it is", "all");
  const found = await page.evaluate(async () => {
    const { cuts, spanOf } = await import(/* @vite-ignore */ "/src/fuzz/wholeCutout.ts");
    const { COMPANY_SPOT } = await import(/* @vite-ignore */ "/src/garden/bench.ts");
    const s = window.__garden as unknown as Drawn;
    const bench = window.__garden.game.bench;
    // Not the fish: it lies flat in the pond, not up toward you. Not one hiding: it is behind a thing on purpose (hide.ts).
    // Not one that is nowhere yet: the mole comes up only where you stood.
    const up = s.guests.sprites.filter((v) => v.kind.stand !== "lying");
    // One fixed along its turn (the snail on the fence) reaches only along it; the rest turn to face you.
    const rests = up
      .filter((v) => v.body.visible && !v.body.hiding)
      .map((v) => ({ who: `the ${v.kind.id}`, at: v.home, ...spanOf(Object.values(v.kind.art), v.size, v.kind.stand === "fixed" ? v.body.turn : null) }));
    for (const [id, [dx, dy, dz]] of Object.entries(COMPANY_SPOT)) {
      const v = up.find((v) => v.kind.id === id);
      if (!v) throw new Error(`no ${id} in the garden: ?visitors=all brings every one`);
      // Where game.ts sitBeside sends it.
      rests.push({ who: `the ${id} beside you`, at: [bench.x + dx, dy, bench.z + dz], ...spanOf(Object.values(v.kind.art), v.size, null) });
    }
    return cuts(s.hitBoxes, rests).map((c) => `${c.who}, by the ${c.by}`);
  });
  expect(found, "a solid thing reaches into the circle a cut-out sweeps as it turns to face you, or onto a fixed one's line").toEqual([]);
});
