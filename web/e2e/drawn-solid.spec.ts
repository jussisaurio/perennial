// Probe for #1138: CI runs this changed spec on the PR. Never merge.
import type { OpenSpot } from "../src/fuzz/drawnSolid";
import type { HitBox, HitDisc } from "../src/garden/scenery";
import { openWalkBuilt, TIMES } from "./spots";
import { expect, test } from "./test";

// garden.drawn-solid (docs/invariants.md): each thing the scene draws as solid stops a walker.
// It reads the scene's own tap volumes (drawnSolid.ts), in a garden with as much in it as the
// story allows: the hedge's door open, the way over the stile cut, notes on the shed's nails.

/** Things drawn as solid that do not stop a walker yet, and the issue that makes them. A fixed one fails the test until it leaves this list. */
const KNOWN: Partial<Record<OpenSpot["id"], string>> = {
  lantern: "#1032",
  sunflower: "#1032",
  sign: "#1122",
};

/** The scene's tap volumes this test reads. They are private to the scene, so the test casts to reach them, as door.spec.ts does. */
type Drawn = { hitBoxes: HitBox[]; hitDiscs: HitDisc[]; lanterns: { boxes: HitBox[] } };

test("garden.drawn-solid: each thing drawn as solid stops a walker, with the door and the way over the stile open", async ({ page }) => {
  // Visitors and what they bring (the snail's sign) depend on the day.
  await page.clock.setFixedTime(TIMES.day);
  // Built is enough: every tap volume is in by then. The 800 plants' sprites come after, and on CI's software
  // WebGL they took over 30 s (run 43576713657).
  await openWalkBuilt(page, "es:800", "open");
  const spots = await page.evaluate(async () => {
    const { openSpots } = await import(/* @vite-ignore */ "/src/fuzz/drawnSolid.ts");
    const { standAt } = await import(/* @vite-ignore */ "/src/garden/ground.ts");
    const { EYE } = await import(/* @vite-ignore */ "/src/garden/game.ts");
    const s = window.__garden as unknown as Drawn;
    const g = window.__garden.game;
    return openSpots([...s.hitBoxes, ...s.lanterns.boxes], s.hitDiscs, (x, z) => standAt(g.world.ground, x, z), (x, z) => g.lift(x, z), EYE);
  });
  const ids = [...new Set(spots.map((s) => s.id))];
  const where = (id: string) => spots.filter((s) => s.id === id).map((s) => `(${s.x.toFixed(2)}, ${s.z.toFixed(2)})`).join(" ");
  expect(ids.filter((id) => !KNOWN[id]).map((id) => `${id} at ${where(id)}`), "drawn as solid, but a walker may stand there").toEqual([]);
  expect(Object.keys(KNOWN).filter((id) => !ids.includes(id as OpenSpot["id"])), "fixed: take these out of KNOWN").toEqual([]);
});
