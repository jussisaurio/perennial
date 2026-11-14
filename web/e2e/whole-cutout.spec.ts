import type { Body, VisitorKind } from "../src/garden/kinds/kind";
import type { HitBox } from "../src/garden/scenery";
import { openWalkBuilt, TIMES } from "./spots";
import { expect, test } from "./test";

// render.whole-cutout (docs/invariants.md): a visitor at rest is drawn whole from every side.
// It reads the scene's own tap volumes and each visitor's place (wholeCutout.ts), with every
// visitor in the garden, and the places by you on the bench where the bird, the cat and the gnome sit.

/** Cut-outs that a solid thing cuts, and the issue that fixes it. A fixed one fails the test until it leaves this list. */
const KNOWN: Partial<Record<string, string>> = {
  "the snail, by the fence": "#1161",
  // At noon on this day it creeps behind the sign on the back fence.
  "the snail, by the sign": "#1161",
};

/** The scene's parts this test reads. They are private to the scene, so the test casts to reach them, as drawn-solid.spec.ts does. */
type Drawn = {
  hitBoxes: HitBox[];
  guests: { sprites: { kind: VisitorKind; size: number; home: [number, number, number]; body: Body<string> }[] };
};

test("render.whole-cutout: no solid thing cuts a visitor at rest, from any side, nor one sitting with you on the bench", async ({ page }) => {
  // Where each visitor is depends on the day: on this one the cat sleeps on the bench.
  await page.clock.setFixedTime(TIMES.day);
  // Built is enough: every tap volume and visitor is in by then (drawn-solid.spec.ts).
  await openWalkBuilt(page, "es:800", "as it is", "all");
  const found = await page.evaluate(async () => {
    const { cuts, reachOf } = await import(/* @vite-ignore */ "/src/fuzz/wholeCutout.ts");
    const { COMPANY_SPOT } = await import(/* @vite-ignore */ "/src/garden/bench.ts");
    const s = window.__garden as unknown as Drawn;
    const bench = window.__garden.game.bench;
    // Not the fish: it lies flat in the pond, not up toward you. Not one hiding: it is behind a thing on purpose (hide.ts).
    // Not one that is nowhere yet: the mole comes up only where you stood.
    const up = s.guests.sprites.filter((v) => !v.kind.lying);
    const rests = up.filter((v) => v.body.visible && !v.body.hiding).map((v) => ({ who: `the ${v.kind.id}`, at: v.home, ...reachOf(Object.values(v.kind.art), v.size) }));
    for (const [id, [dx, dy, dz]] of Object.entries(COMPANY_SPOT)) {
      const v = up.find((v) => v.kind.id === id);
      if (!v) throw new Error(`no ${id} in the garden: ?visitors=all brings every one`);
      // Where game.ts sitBeside sends it.
      rests.push({ who: `the ${id} beside you`, at: [bench.x + dx, dy, bench.z + dz], ...reachOf(Object.values(v.kind.art), v.size) });
    }
    return cuts(s.hitBoxes, rests).map((c) => `${c.who}, by the ${c.by}`);
  });
  expect(
    found.filter((f) => !KNOWN[f]),
    "a solid thing reaches into the circle its cut-out sweeps as it turns to face you",
  ).toEqual([]);
  expect(
    Object.keys(KNOWN).filter((k) => !found.includes(k)),
    "fixed: take these out of KNOWN",
  ).toEqual([]);
});
