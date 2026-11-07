import { expect, test, type Page } from "./test";
import { doorNow, gameSeconds, pinDetail, serverRows, standAtDoor, standBy, standByKey, trackOf, trackVisitors, waitForSynced } from "./helpers";

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
  // Low detail: software WebGL on CI draws it faster, and every click waits for frames.
  await pinDetail(page, "low");
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
  await expect(page.locator(".gw-say")).toHaveText("Cerrado con llave.");
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
  const llaveId = await page.evaluate(async () => {
    const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
    const { loadDeck } = await import(/* @vite-ignore */ "/src/data/deck.ts");
    const llave = (await loadDeck("es")).words.find((w: { lemma: string }) => w.lemma === "llave")!.id as string;
    const at = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const id = crypto.randomUUID();
    await postWrite([{ type: "review.insert", row: { id, lang: "es", word_id: llave, skill: "read", grade: 4, kind: "known", reviewed_at: at, duration_ms: 4000, sentence_id: null } }]);
    return id;
  });
  // Open the app again, so the walk's snapshot surely has the review.
  await page.goto("/#/today");
  // Wait on the review landing in the (freshly loaded) app's own data (#343), not on time.
  await waitForSynced(page, "review", [llaveId]);
  await openWalk(page);
  expect(await doorNow(page)).toMatchObject({ state: "key", key: true });
  // Not by the door: a small find somewhere in the garden.
  expect((await doorNow(page)).keyFromDoor).toBeGreaterThan(4);

  // Tapping the door first: still locked, and no hint of the key there.
  await page.mouse.click(...(await standAtDoor(page)));
  await expect(page.locator(".gw-say")).toHaveText("Cerrado con llave.");
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
  // Only the plain coordinates cross the page boundary: the key's glint is a THREE.Sprite, and
  // cloning it (structured clone, going both ways) strips its Vector3 methods, so Door.tick
  // throws every frame once the clone is written back (#343).
  const home = await page.evaluate(() => {
    const k = (window as unknown as { __garden: { door: { key: { x: number; z: number } } } }).__garden.door.key;
    return { x: k.x, z: k.z };
  });
  await keyInTheOpen(page);
  const far = await standByKey(page, 5);
  expect(await meets(far, false)).toBe("key");
  expect(await meets(far, true)).toBe("scenery");
  expect(await meets(await standByKey(page), true)).toBe("key");
  await page.evaluate((home) => Object.assign((window as unknown as { __garden: { door: { key: { x: number; z: number } } } }).__garden.door.key, home), home);
  // By the key, its button shows, and a screen reader hears that it is here. A tap: one quiet line, and it is gone from the ground.
  const key = await standByKey(page);
  await expect(page.getByRole("button", { name: "Pick up the key" })).toBeVisible();
  await expect(page.locator(".sr-only[role=status]")).toHaveText("The key is here.");
  await page.mouse.click(...key);
  await expect(page.locator(".gw-say")).toHaveText("Has encontrado la llave.");
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
  const reviewIds = await page.evaluate(async () => {
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
    const rows = [review("llave", 3), ...[120, 100, 70, 30].map((d) => review("manzana", d)), review("árbol", 25), review("limón", 2)];
    await postWrite(rows);
    return rows.map((r) => r.row.id);
  });
  await page.goto("/#/today");
  // Wait on the reviews landing in the (freshly loaded) app's own data (#343), not on time, before the walk takes its snapshot.
  await waitForSynced(page, "review", reviewIds);
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
  // The walk takes its snapshot as it opens: wait until the review has synced into the (freshly loaded) app's own data (#343), not on time.
  await waitForSynced(page, "review", [id]);
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
test("a key left a week glints whenever you face it, from afar and in reach; a key left a day does not", async ({ page }) => {
  await keyWaited(page, 1);
  await keyInTheOpen(page);
  await standByKey(page, 5);
  expect(await keyGlints(page)).toBe(false);

  await keyWaited(page, 8);
  await keyInTheOpen(page);
  await standByKey(page, 5);
  // With reduced motion (as these tests run), a still glint.
  expect(await keyGlints(page)).toBe(true);
  // In reach it keeps glinting (#689): no other mark takes its place there.
  await standByKey(page);
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
      const s = (window as unknown as { __garden: { door: { key: { x: number; z: number } }; guests: { sprites: { v: { id: string }; body: { at: { x: number; z: number } } }[] } } }).__garden;
      const b = s.guests.sprites.find((o) => o.v.id === "bird")!.body.at;
      return Math.hypot(b.x - s.door.key.x, b.z - s.door.key.z);
    });
  // Noon: the bird is in its own spot, away from the key.
  expect(await birdFromKey()).toBeGreaterThan(1);
  // Come back at seven in the evening, then at noon again.
  const comeBackAt = async (at: string) => {
    await page.clock.setFixedTime(new Date(at));
    await page.getByRole("button", { name: "Back" }).click();
    await openWalk(page);
  };
  await comeBackAt("2026-10-11T19:00:00");
  await expect(page.locator(".gw")).toHaveClass(/\bgw-dusk\b/);
  expect(await birdFromKey()).toBeLessThan(1);
  await comeBackAt("2026-10-11T12:00:00");
  await expect(page.locator(".gw")).toHaveClass(/\bgw-day\b/);
  expect(await birdFromKey()).toBeGreaterThan(1);
});

// docs/garden-play.md, "The door in the hedge and the key" (#802): the dog waits by the key as a hint you can see, and nobody jumps.
type Body = { x: number; y: number; z: number; at: { x: number; y: number; z: number } };
type Guest = { v: { id: string }; home: [number, number, number]; uv: { getZ(i: number): number }; body: Body };
type KeyScene = {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  camera: unknown;
  tmp: { constructor: new (x: number, y: number, z: number) => { project(c: unknown): { x: number; y: number } } };
  layout: { bounds: { minX: number; maxX: number; minZ: number; maxZ: number } };
  door: { key: { x: number; z: number } };
  guests: { sprites: Guest[] };
  doorAct(a: string): void;
};

/** How far a visitor is drawn from the key, from its own place today, and from where it was sent (m). */
const whereIs = (page: Page, id: string) =>
  page.evaluate((id) => {
    const s = (window as unknown as { __garden: KeyScene }).__garden;
    const g = s.guests.sprites.find((o) => o.v.id === id)!;
    const b = g.body;
    const k = s.door.key;
    return { key: Math.hypot(b.x - k.x, b.z - k.z), home: Math.hypot(b.x - g.home[0], b.y - g.home[1], b.z - g.home[2]), at: Math.hypot(b.x - b.at.x, b.y - b.at.y, b.z - b.at.z) };
  }, id);

test("key.dog-beside: with the key left four days, the dog sits on open ground beside it, on the side away from the middle of the garden", async ({ page }) => {
  await keyWaited(page, 4, "&visitors=dog");
  const dog = await page.evaluate(async () => {
    const { collide } = await import(/* @vite-ignore */ "/src/garden/world.ts");
    const s = (window as unknown as { __garden: KeyScene }).__garden;
    const b = s.guests.sprites.find((o) => o.v.id === "dog")!.body;
    const k = s.door.key;
    const L = s.layout.bounds;
    const p = collide(s.layout as Parameters<typeof collide>[0], b.x, b.z);
    const away = (b.x - k.x) * (k.x - (L.minX + L.maxX) / 2) + (b.z - k.z) * (k.z - (L.minZ + L.maxZ) / 2);
    return { open: p.x === b.x && p.z === b.z, away: away > 0 };
  });
  expect(dog).toEqual({ open: true, away: true });
  const { key, at } = await whereIs(page, "dog");
  expect(key).toBeGreaterThan(0.6);
  expect(key).toBeLessThan(1);
  // It sits there from the start.
  expect(at).toBe(0);
});

test("key.dog-looks: seen from either side, the dog's picture faces the key", async ({ page }) => {
  await keyWaited(page, 4, "&visitors=dog");
  const seenFrom = (side: number) =>
    page.evaluate(
      (side) =>
        new Promise<{ flipped: boolean; keyLeft: boolean }>((done) => {
          const s = (window as unknown as { __garden: KeyScene }).__garden;
          const g = s.guests.sprites.find((o) => o.v.id === "dog")!;
          const [d, k] = [g.body, s.door.key];
          const len = Math.hypot(k.x - d.x, k.z - d.z);
          // 3 m out from the dog, square to the line from it to the key, looking at the dog. Forward is -z at yaw 0.
          const [x, z] = [d.x - ((k.z - d.z) / len) * 3 * side, d.z + ((k.x - d.x) / len) * 3 * side];
          Object.assign(s, { x, z, yaw: Math.atan2(-(d.x - x), -(d.z - z)), pitch: -0.2 });
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const onScreen = (px: number, pz: number) => new s.tmp.constructor(px, 0, pz).project(s.camera).x;
              done({ flipped: g.uv.getZ(0) < 0, keyLeft: onScreen(k.x, k.z) < onScreen(d.x, d.z) });
            }),
          );
        }),
      side,
    );
  const one = await seenFrom(1);
  const other = await seenFrom(-1);
  expect(one.keyLeft).not.toBe(other.keyLeft);
  for (const v of [one, other]) expect(v.flipped).toBe(v.keyLeft);
});

// Without the dog it glints: the test above.
test("key.no-glint-with-dog: a key left a week does not glint while the dog waits by it", async ({ page }) => {
  await keyWaited(page, 8, "&visitors=dog");
  await keyInTheOpen(page);
  await standByKey(page, 5);
  expect(await keyGlints(page)).toBe(false);
});

test("key.tap-dog: a tap on the dog by the key shows the dog's name, and the key stays on the ground", async ({ page }) => {
  await keyWaited(page, 4, "&visitors=dog");
  const dog = await page.evaluate(() => (window as unknown as { __garden: KeyScene }).__garden.guests.sprites.find((o) => o.v.id === "dog")!.body.at);
  await page.mouse.click(...(await standBy(page, { x: dog.x, y: 0.2, z: dog.z }, 3)));
  await expect(page.locator(".gw-tag", { hasText: "el perro" })).toBeVisible();
  expect(await doorNow(page)).toMatchObject({ state: "key", key: true });
});

test.describe(() => {
  // The visitors are seen going home, not put there at once.
  test.use({ reducedMotion: "no-preference" });
  // On CI's software WebGL (~7 frames a second) the walk takes 10–20 s to open; then the dog waits and trots home in real time.
  test.describe.configure({ timeout: 60_000 });

  test("key.dog-walks-home: picking up the key, the dog stays a moment, then trots home a short step at a time, never over a bed", async ({ page }) => {
    await keyWaited(page, 4, "&visitors=dog");
    await standByKey(page);
    await trackVisitors(page, ["dog"]);
    await page.getByRole("button", { name: "Pick up the key" }).click();
    await expect.poll(async () => (await doorNow(page)).state).toBe("held");
    await gameSeconds(page, 2);
    expect((await whereIs(page, "dog")).key).toBeLessThan(1);
    await expect.poll(async () => (await whereIs(page, "dog")).home, { timeout: 30_000 }).toBeLessThan(0.01);
    const way = await trackOf(page, "dog");
    expect(way.step).toBeLessThan(0.6);
    expect(way.went).toBeGreaterThan(1);
    expect(way.inBed).toBe(0);
  });

  test("key.bird-flies-home: at dusk, picking up the key, the bird flies home to its own perch a short way at a time", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-11T19:00:00"));
    await keyWaited(page, 4, "&visitors=bird");
    expect((await whereIs(page, "bird")).key).toBeLessThan(1);
    // Stand in the garden's corner farthest from both the key and the bird's perch: near either, it would hop off from you instead.
    await page.evaluate(() => {
      const s = (window as unknown as { __garden: KeyScene }).__garden;
      const { minX, maxX, minZ, maxZ } = s.layout.bounds;
      const home = s.guests.sprites.find((o) => o.v.id === "bird")!.home;
      const away = (p: [number, number]) => Math.min(Math.hypot(p[0] - s.door.key.x, p[1] - s.door.key.z), Math.hypot(p[0] - home[0], p[1] - home[2]));
      const corners: [number, number][] = [[minX + 1, minZ + 1], [minX + 1, maxZ - 1], [maxX - 1, minZ + 1], [maxX - 1, maxZ - 1]];
      const [x, z] = corners.reduce((a, b) => (away(b) > away(a) ? b : a));
      Object.assign(s, { x, z });
    });
    await trackVisitors(page, ["bird"]);
    await page.evaluate(() => (window as unknown as { __garden: KeyScene }).__garden.doorAct("key"));
    await expect.poll(async () => (await whereIs(page, "bird")).home, { timeout: 30_000 }).toBeLessThan(0.01);
    const way = await trackOf(page, "bird");
    expect(way.step).toBeLessThan(0.6);
    expect(way.went).toBeGreaterThan(1);
  });
});
