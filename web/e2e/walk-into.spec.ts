import { expect, test, type Page } from "./test";

// #359, walk into things (#335 V6): no button, your body is the verb. Brush
// past a bed and its plants play their notes (and sway); walk into an orchard
// tree and a fruit falls, with its word; in autumn, walk into a leaf pile and
// it bursts, then gathers itself again.

/** The parts of the dev-only scene handle (window.__garden) these tests read and move. */
type IntoScene = {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  layout: { beds: { x: number; z: number; w: number; d: number }[]; plants: { bed: number }[] };
  orchard: { trees: { lemma: string; look: string; x: number; z: number; trunk: number }[] } | null;
  plants: { brush: { moving: number } };
  walkInto: { piles: { x: number; z: number }[]; pileOut: Int16Array; bitsOut: number };
};

async function openWalk(page: Page) {
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
}

/** Stand at (x, z) facing `yaw` (forward is -z at yaw 0), then walk forward with the W key until `until` holds: software WebGL on CI draws few frames a second, so a walk is measured in metres, not time. */
async function walkFrom(page: Page, at: { x: number; z: number; yaw: number }, until: () => Promise<unknown>) {
  await page.evaluate((at) => Object.assign((window as unknown as { __garden: IntoScene }).__garden, { ...at, pitch: -0.2 }), at);
  await page.keyboard.down("KeyW");
  await until();
  await page.keyboard.up("KeyW");
}

/** The bed with the most plants: the demo's first bed (nouns) may hold only one. */
const fullestBed = (page: Page) =>
  page.evaluate(() => {
    const { beds, plants } = (window as unknown as { __garden: IntoScene }).__garden.layout;
    const count = (i: number) => plants.filter((p) => p.bed === i).length;
    return beds.reduce((best, b, i) => (count(i) > count(beds.indexOf(best)) ? b : best));
  });

const walkerX = (page: Page) => page.evaluate(() => (window as unknown as { __garden: IntoScene }).__garden.x);

test.beforeEach(async ({ page }) => {
  // Mid October: autumn, when the leaf piles lie on the paths.
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  // Low quality: software WebGL on CI draws it faster.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
  // Count the notes played: each brushed plant starts an oscillator or two (ui/chime.ts).
  await page.addInitScript(() => {
    const w = window as unknown as { notes: number };
    w.notes = 0;
    const make = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function (this: AudioContext) {
      w.notes++;
      return make.call(this);
    };
  });
});

test("brushing a bed plays its words' notes; walking into the apple tree drops an apple, with its word, said to screen readers too", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?demo=es:30#/today");
  await expect(page.getByRole("button", { name: "Walk in your garden" })).toBeVisible({ timeout: 20_000 });
  // The door is open, and manzana was known long ago: its tree bears fruit.
  await page.evaluate(async () => {
    const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
    const { loadDeck } = await import(/* @vite-ignore */ "/src/data/deck.ts");
    const words = (await loadDeck("es")).words as { id: string; lemma: string }[];
    const id = words.find((w) => w.lemma === "manzana")!.id;
    const review = (daysAgo: number) => ({
      type: "review.insert",
      row: { id: crypto.randomUUID(), lang: "es", word_id: id, skill: "read", grade: 4, kind: "known", reviewed_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(), duration_ms: 4000, sentence_id: null },
    });
    await postWrite([{ type: "course.upsert", row: { lang: "es", door_open: true } }, ...[120, 100, 70, 30].map(review)]);
  });
  await page.goto("/#/today");
  await openWalk(page);

  // Along the front of a full bed, hugging it, facing along it (+x): a run of notes, one or two oscillators each.
  const bed = await fullestBed(page);
  expect(await page.evaluate(() => (window as unknown as { notes: number }).notes)).toBe(0);
  await walkFrom(page, { x: bed.x - bed.w / 2 - 0.5, z: bed.z + bed.d / 2 + 0.3, yaw: -Math.PI / 2 }, () => expect.poll(() => walkerX(page), { timeout: 20_000 }).toBeGreaterThan(bed.x + bed.w / 2));
  expect(await page.evaluate(() => (window as unknown as { notes: number }).notes)).toBeGreaterThanOrEqual(4);

  // Walk into the apple tree from the door's side: an apple falls (with reduced motion, it lies beside the trunk at once).
  const tree = await page.evaluate(() => (window as unknown as { __garden: IntoScene }).__garden.orchard!.trees.find((t) => t.lemma === "manzana")!);
  expect(tree.look).toBe("fruit");
  // Facing +z (yaw π), the tree straight ahead.
  await walkFrom(page, { x: tree.x, z: tree.z - tree.trunk - 1.2, yaw: Math.PI }, () => expect(page.locator(".gw-tag").filter({ hasText: "manzana" })).toContainText("apple", { timeout: 20_000 }));
  await expect(page.getByRole("status").filter({ hasText: "fell" })).toHaveText("An apple fell. manzana");
  await expect(page.getByRole("status").locator('[lang="es"]')).toHaveText("manzana");
  expect(errors).toEqual([]);
});

test.describe("with motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("brushed plants sway; a leaf pile bursts when you walk into it, then its leaves creep home", async ({ page }) => {
    // The leaves take about ten seconds to come home, after the app's first load (slow on a cold dev server): more than the default 30 s in all.
    test.setTimeout(60_000);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("/?demo=es:30#/today");
    await openWalk(page);
    const scene = () => page.evaluate(() => {
      const s = (window as unknown as { __garden: IntoScene }).__garden;
      return { moving: s.plants.brush.moving, out: [...s.walkInto.pileOut], bits: s.walkInto.bitsOut, piles: s.walkInto.piles };
    });

    // Brushing a bed: its plants lean away and spring back.
    const bed = await fullestBed(page);
    await page.evaluate((bed) => Object.assign((window as unknown as { __garden: IntoScene }).__garden, { x: bed.x - bed.w / 2 - 0.5, z: bed.z + bed.d / 2 + 0.3, yaw: -Math.PI / 2 }), bed);
    await page.keyboard.down("KeyW");
    await expect.poll(async () => (await scene()).moving).toBeGreaterThan(0);
    await page.keyboard.up("KeyW");
    await expect.poll(async () => (await scene()).moving, { timeout: 10_000 }).toBe(0);

    // A pile on the path: walk into it from a step away, along its path (beside a bed, the path runs along z; behind one, along x).
    const pile = (await scene()).piles[0];
    expect(pile).toBeDefined();
    await page.evaluate((p) => {
      const s = (window as unknown as { __garden: IntoScene }).__garden;
      const beside = s.layout.beds.some((b) => Math.abs(b.z - p.z) < 0.01);
      // Forward is -z at yaw 0, and -x at yaw π/2.
      Object.assign(s, beside ? { x: p.x, z: p.z + 1.2, yaw: 0 } : { x: p.x + 1.2, z: p.z, yaw: Math.PI / 2 });
    }, pile);
    await page.keyboard.down("KeyW");
    await expect.poll(async () => (await scene()).out[0]).toBeGreaterThan(0);
    await page.keyboard.up("KeyW");
    // They float down, lie a moment, and creep back: the pile is whole again.
    await expect.poll(async () => (await scene()).out[0], { timeout: 30_000 }).toBe(0);
    expect((await scene()).bits).toBe(0);
    expect(errors).toEqual([]);
  });
});
