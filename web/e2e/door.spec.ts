import { expect, test, type Page } from "./test";
import { doorNow, serverRows, standAtDoor, standByKey } from "./helpers";

// #315: the old door in the hedge. Locked until "key" (llave) brings the key,
// which hides somewhere in the garden (a different place for each learner);
// a tap picks the key up, a tap opens the door, and it stays open for good.

/**
 * Lay the key, for picking, on the open path in front of the first bed: its
 * own place differs per learner, and some (under the bench) can only be seen
 * from close by. The drawn key stays where it was.
 */
function keyInTheOpen(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __garden: { layout: { beds: { x: number; z: number; d: number }[] }; door: { key: { x: number; z: number } } } }).__garden;
    const bed = s.layout.beds[0];
    Object.assign(s.door.key, { x: bed.x + 1.2, z: bed.z + bed.d / 2 + 1 });
  });
}

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
  await standAtDoor(page);
  await expect(page.getByRole("button", { name: "Pick up the key" })).toHaveCount(0);
  // One action button (#334): only an icon, no words; a screen reader hears what it does.
  await expect(page.getByRole("button", { name: "Try the door" })).toHaveText("");
  await page.getByRole("button", { name: "Try the door" }).click();
  await expect(page.locator(".gw-say")).toHaveText("Locked.");
  // The drawn line is hidden from screen readers; a status says it to them.
  await expect(page.getByRole("status").filter({ hasText: "Locked." })).toHaveText("Locked.");
  expect(await doorNow(page)).toMatchObject({ state: "locked" });
  expect(errors).toEqual([]);
});

test("'llave' brings the key, hidden away from the door: a tap picks it up, a tap opens the door, and it is still open after a reload", async ({ page }) => {
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
  // Not by the door: a small find somewhere in the garden.
  expect((await doorNow(page)).keyFromDoor).toBeGreaterThan(4);

  // Tapping the door first: still locked, and no hint of the key there.
  await page.mouse.click(...(await standAtDoor(page)));
  await expect(page.locator(".gw-say")).toHaveText("Locked.");
  // A screen reader also hears where it lies, as a thing in the world (#334): what a seeing learner might spot cannot be heard.
  await expect(page.locator(".sr-only[role=status]")).toHaveText(/^Locked\. Something small glints (under|among|by) the /);
  await expect(page.getByRole("button", { name: "Try the door" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pick up the key" })).toHaveCount(0);
  // From afar (#336), a tap meets the key; but when something stands in front of it, the tap meets that instead, as before.
  // In reach, the key comes first.
  const meets = (at: [number, number], blocked: boolean) =>
    page.evaluate(
      ([x, y, blocked]) => {
        type Box = { id: string; min: number[]; max: number[]; tag: null };
        const s = (window as unknown as { __garden: { x: number; z: number; hitBoxes: Box[]; door: { key: { x: number; z: number } }; pickAny(x: number, y: number, w: number, h: number): { kind: string; a?: string } | null } }).__garden;
        const k = s.door.key;
        const [mx, mz] = [(s.x + k.x) / 2, (s.z + k.z) / 2];
        if (blocked) s.hitBoxes.push({ id: "stone", min: [mx - 0.2, 0, mz - 0.2], max: [mx + 0.2, 1.2, mz + 0.2], tag: null });
        const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
        const hit = s.pickAny(x - r.left, y - r.top, r.width, r.height);
        if (blocked) s.hitBoxes.pop();
        return hit?.a ?? hit?.kind;
      },
      [...at, blocked] as const,
    );
  const home = await page.evaluate(() => ({ ...(window as unknown as { __garden: { door: { key: { x: number; z: number } } } }).__garden.door.key }));
  await keyInTheOpen(page);
  const far = await standByKey(page, 5);
  expect(await meets(far, false)).toBe("key");
  expect(await meets(far, true)).toBe("scenery");
  expect(await meets(await standByKey(page), true)).toBe("key");
  await page.evaluate((home) => Object.assign((window as unknown as { __garden: { door: { key: object } } }).__garden.door.key, home), home);
  // By the key, its button shows, and a screen reader hears that it is here. A tap: one quiet line, and it is gone from the ground.
  const key = await standByKey(page);
  await expect(page.getByRole("button", { name: "Pick up the key" })).toBeVisible();
  await expect(page.locator(".sr-only[role=status]")).toHaveText("The key is here.");
  await page.mouse.click(...key);
  await expect(page.locator(".gw-say")).toHaveText("You found the key.");
  expect(await doorNow(page)).toMatchObject({ state: "held", key: false });
  await expect(page.getByRole("button", { name: "Pick up the key" })).toHaveCount(0);
  // The door opens; with reduced motion (as these tests run) at once, without a swing.
  const door = await standAtDoor(page);
  await expect(page.getByRole("button", { name: "Open the door with the key" })).toBeVisible();
  await page.mouse.click(...door);
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

  // A tap on the key from afar walks up to it and picks it up (#336).
  await keyInTheOpen(page);
  await page.mouse.click(...(await standByKey(page, 5)));
  await expect.poll(async () => (await doorNow(page)).state, { timeout: 15_000 }).toBe("held");
  await standAtDoor(page);
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
  await standAtDoor(page);
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

/** "I knew it" on llave `daysAgo` days before the pinned clock, then the walk opens (with `visitors`, a dev list of who visits). */
async function keyWaited(page: Page, daysAgo: number, visitors = "") {
  await page.goto(`/?demo=es:30${visitors}#/today`);
  await expect(page.getByRole("button", { name: "Walk in your garden" })).toBeVisible({ timeout: 20_000 });
  const id = await page.evaluate(async (daysAgo) => {
    const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
    const { loadDeck } = await import(/* @vite-ignore */ "/src/data/deck.ts");
    const llave = (await loadDeck("es")).words.find((w: { lemma: string }) => w.lemma === "llave")!.id as string;
    const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    const id = crypto.randomUUID();
    await postWrite([{ type: "review.insert", row: { id, lang: "es", word_id: llave, skill: "read", grade: 4, kind: "known", reviewed_at: at, duration_ms: 4000, sentence_id: null } }]);
    return id;
  }, daysAgo);
  await page.goto(`/${visitors.replace("&", "?")}#/today`);
  // The walk takes its snapshot as it opens: wait until the review has synced into the app's own data (#343), not on time.
  await page.waitForFunction((id) => (window as unknown as { __store?: { collections: { review: { has(k: string): boolean } } } }).__store?.collections.review.has(id), id, { timeout: 20_000 });
  await openWalk(page);
  expect(await doorNow(page)).toMatchObject({ state: "key" });
}

/** Whether the key's own glint shows now, after two frames. */
const keyGlints = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<boolean>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done((window as unknown as { __garden: { door: { key: { glint: { visible: boolean } } } } }).__garden.door.key.glint.visible))),
      ),
  );

// #334: help for a stuck key hunt comes from the world, late and gently, never as text. The clock is pinned (beforeEach).
test("a key left a week glints whenever you face it, from afar; a key left a day does not", async ({ page }) => {
  await keyWaited(page, 1);
  await keyInTheOpen(page);
  await standByKey(page, 5);
  expect(await keyGlints(page)).toBe(false);

  await keyWaited(page, 8);
  await keyInTheOpen(page);
  await standByKey(page, 5);
  // With reduced motion (as these tests run), a still glint.
  expect(await keyGlints(page)).toBe(true);
  // Facing away: nothing calls from behind you.
  await page.evaluate(() => ((window as unknown as { __garden: { yaw: number } }).__garden.yaw += Math.PI));
  expect(await keyGlints(page)).toBe(false);
  // No words in the walk say where it is: no line from the garden (the controls hint, if it shows, only teaches the controls).
  await expect(page.locator(".gw-say")).toHaveCount(0);
});

test("a key left a few days: at dusk the bird waits by it, and by day it is back in its own spot", async ({ page }) => {
  await keyWaited(page, 4, "&visitors=bird");
  const birdFromKey = () =>
    page.evaluate(() => {
      const s = (window as unknown as { __garden: { door: { key: { x: number; z: number } }; guests: { sprites: { v: { id: string }; x: number; z: number }[] } } }).__garden;
      const b = s.guests.sprites.find((o) => o.v.id === "bird")!;
      return Math.hypot(b.x - s.door.key.x, b.z - s.door.key.z);
    });
  // Noon: the bird is in its own spot, away from the key.
  expect(await birdFromKey()).toBeGreaterThan(1);
  const time = page.getByRole("button", { name: /^Time of day: / });
  await time.click();
  await expect(time).toHaveAttribute("aria-label", "Time of day: Evening");
  expect(await birdFromKey()).toBeLessThan(0.5);
  await time.click();
  await time.click();
  await expect(time).toHaveAttribute("aria-label", "Time of day: Day");
  expect(await birdFromKey()).toBeGreaterThan(1);
});
