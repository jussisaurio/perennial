import { expect, test, type Page } from "@playwright/test";
import { doorNow, serverRows, standAtDoor } from "./helpers";

// #315: the old door in the hedge. Locked until "key" (llave) brings the key;
// a tap picks the key up, a tap opens the door, and it stays open for good.

async function openWalk(page: Page) {
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
}

test.beforeEach(async ({ page }) => {
  // A fixed day and hour: visitors change by day, and the snail walks the fence over the day.
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  // Low quality: software WebGL on CI draws it faster, and every click waits for frames.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
});

test("the locked door says so by its button, to screen readers too; without the word 'llave' there is no key", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The demo learner's 30 words are the most common ones: llave is not among them.
  await page.goto("/?demo=es:30#/today");
  await openWalk(page);
  expect(await doorNow(page)).toMatchObject({ state: "locked", key: null });
  // Near the door, a button does what a tap does (the tap is in the next test), for keyboards and screen readers.
  await standAtDoor(page, "door");
  await expect(page.getByRole("button", { name: "Pick up the key" })).toHaveCount(0);
  await page.getByRole("button", { name: "Try the door" }).click();
  await expect(page.locator(".gw-say")).toHaveText("Locked. The key must be somewhere.");
  // The drawn line is hidden from screen readers; a status says it to them.
  await expect(page.getByRole("status").filter({ hasText: "Locked." })).toHaveText("Locked. The key must be somewhere.");
  expect(await doorNow(page)).toMatchObject({ state: "locked" });
  expect(errors).toEqual([]);
});

test("'llave' brings the key: a tap picks it up, a tap opens the door, and it is still open after a reload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?demo=es:30#/today");
  await expect(page.getByRole("button", { name: "Walk in your garden" })).toBeVisible({ timeout: 20_000 });
  // "I knew it" on llave, days ago: a good reading answer brings its thing to the garden (#209).
  await page.evaluate(async () => {
    const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
    const { loadDeck } = await import(/* @vite-ignore */ "/src/data/deck.ts");
    const llave = (await loadDeck("es")).words.find((w: { lemma: string }) => w.lemma === "llave")!.id as string;
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await postWrite([{ type: "review.insert", row: { id: crypto.randomUUID(), lang: "es", word_id: llave, skill: "read", grade: 4, kind: "known", reviewed_at: at, duration_ms: 4000, sentence_id: null } }]);
  });
  // Open the app again, so the walk's snapshot surely has the review.
  await page.goto("/#/today");
  await openWalk(page);
  expect(await doorNow(page)).toMatchObject({ state: "key", key: true });

  // Tapping the door first: still locked.
  await page.mouse.click(...(await standAtDoor(page, "door")));
  await expect(page.locator(".gw-say")).toHaveText("Locked. The key must be somewhere.");
  // The key: one quiet line, and it is gone from the ground.
  await page.mouse.click(...(await standAtDoor(page, "key")));
  await expect(page.locator(".gw-say")).toHaveText("You found the key.");
  expect(await doorNow(page)).toMatchObject({ state: "held", key: false });
  await expect(page.getByRole("button", { name: "Open the door with the key" })).toBeVisible();
  // The door opens; with reduced motion (as these tests run) at once, without a swing.
  await page.mouse.click(...(await standAtDoor(page, "door")));
  await expect.poll(async () => (await doorNow(page)).state).toBe("open");
  expect((await doorNow(page)).angle).toBeCloseTo(Math.PI / 2);
  await expect(page.getByRole("button", { name: /door/ })).toHaveCount(0);
  // Saved with the course, on the server: it syncs to the learner's other devices.
  await expect.poll(async () => (await serverRows<{ door_open: boolean }>(page, "course"))[0]?.door_open, { timeout: 15_000 }).toBe(true);

  await page.goto("/#/today");
  await openWalk(page);
  expect(await doorNow(page)).toMatchObject({ state: "open", key: null });
  expect((await doorNow(page)).angle).toBeCloseTo(Math.PI / 2);
  expect(errors).toEqual([]);
});

/** The parts of the dev-only scene handle (window.__garden) the orchard test reads. */
type OrchardScene = {
  x: number;
  z: number;
  camera: unknown;
  tmp: { constructor: new (x: number, y: number, z: number) => { project(c: unknown): { x: number; y: number } } };
  layout: { orchard: { z: number; d: number } };
  orchard: { trees: { lemma: string; gloss: string; height: number; look: string; x: number; z: number }[] } | null;
};
const orchardNow = (page: Page) => page.evaluate(() => (window as unknown as { __garden: OrchardScene }).__garden.orchard);

test("behind the open door, the orchard: a tree for each orchard word started, tapping one shows its word, and you can walk in", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?demo=es:30#/today");
  await expect(page.getByRole("button", { name: "Walk in your garden" })).toBeVisible({ timeout: 20_000 });
  // The key's word, and three orchard words planted at different times: manzana months ago, árbol weeks ago, limón this week.
  await page.evaluate(async () => {
    const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
    const { loadDeck } = await import(/* @vite-ignore */ "/src/data/deck.ts");
    const words = (await loadDeck("es")).words as { id: string; lemma: string }[];
    const review = (lemma: string, daysAgo: number) => ({
      type: "review.insert",
      row: {
        id: crypto.randomUUID(),
        lang: "es",
        word_id: words.find((w) => w.lemma === lemma)!.id,
        skill: "read",
        grade: 4,
        kind: "known",
        reviewed_at: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
        duration_ms: 4000,
        sentence_id: null,
      },
    });
    await postWrite([review("llave", 3), ...[120, 100, 70, 30].map((d) => review("manzana", d)), review("árbol", 25), review("limón", 2)]);
  });
  await page.goto("/#/today");
  await openWalk(page);
  // A mystery: nothing is built behind the hedge while the door is shut.
  expect(await orchardNow(page)).toBeNull();

  await standAtDoor(page, "key");
  await page.getByRole("button", { name: "Pick up the key" }).click();
  await page.getByRole("button", { name: "Open the door with the key" }).click();
  await expect.poll(async () => (await doorNow(page)).state).toBe("open");

  // Every tree planted so far, each grown for its age: the oldest is the tallest.
  const trees = (await orchardNow(page))!.trees;
  expect(trees.map((t) => t.lemma).sort()).toEqual(["limón", "manzana", "árbol"].sort());
  const tree = (lemma: string) => trees.find((t) => t.lemma === lemma)!;
  expect(tree("manzana").height).toBeGreaterThan(tree("limón").height);
  expect(tree("limón").look).toBe("leaves");

  // Tap the tree nearest the door, from a few steps in front of it: its word and meaning show over it.
  const [x, y, lemma] = await page.evaluate(
    () =>
      new Promise<[number, number, string]>((done) => {
        const s = (window as unknown as { __garden: OrchardScene }).__garden;
        const t = [...s.orchard!.trees].sort((a, b) => a.z - b.z)[0];
        Object.assign(s, { x: t.x, z: t.z - 3, yaw: Math.PI, pitch: 0.1 });
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const v = new s.tmp.constructor(t.x, t.height * 0.6, t.z).project(s.camera);
            const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
            done([r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height, t.lemma]);
          }),
        );
      }),
  );
  await page.mouse.click(x, y);
  await expect(page.locator(".gw-tag")).toContainText(lemma);
  await expect(page.locator(".gw-tag")).toContainText(tree(lemma).gloss);

  // Walk in from the garden, two metres a step (ctrl and the wheel): through the doorway, past the hedge, into the orchard.
  await standAtDoor(page, "door");
  await page.keyboard.down("Control");
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  const at = await page.evaluate(() => {
    const s = (window as unknown as { __garden: OrchardScene }).__garden;
    return { z: s.z, near: s.layout.orchard.z - s.layout.orchard.d / 2 };
  });
  expect(at.z).toBeGreaterThan(at.near);

  // From inside, the hedge hides the garden: a tap on it, over a plant behind it, picks nothing.
  const [px, py] = await page.evaluate(
    () =>
      new Promise<[number, number]>((done) => {
        const s = (window as unknown as { __garden: OrchardScene & { layout: { gate: { x: number }; plants: { x: number; z: number }[] } } }).__garden;
        const near = s.layout.orchard.z - s.layout.orchard.d / 2;
        Object.assign(s, { x: s.layout.gate.x + 3, z: near + 0.5, yaw: 0, pitch: 0 });
        const p = s.layout.plants[0];
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const v = new s.tmp.constructor(p.x, 0.5, p.z).project(s.camera);
            const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
            done([r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]);
          }),
        );
      }),
  );
  await page.mouse.click(px, py);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});
