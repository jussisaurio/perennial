import { expect, test, type Page } from "./test";
import { pinDetail } from "./helpers";

// The back fence, the stile and the hill (#770, docs/garden-play.md "Back
// fence, stile and hill"): one test per claim, played with the keys and a tap
// as the learner would. Only where the learner stands at the start is set by
// hand. Until note n08 (486 known words) brambles shut the stile; after it you
// walk over and up the hill, to the stool, the lantern and the diary (#858).
// The clock is pinned to a day, or a night for the lantern; the viewport to a
// laptop's.

/** The parts of the dev-only scene handle (window.__garden) these tests read and move. */
type HillScene = {
  layout: object;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  camera: { position: { y: number }; fov: number };
  elapsed: number;
  walker: { kind: string };
  /** How far the time-lapse has run: 0 is now; from a day, 2 is night. */
  lapse: number;
  lanterns: { on: boolean[]; lookout: number };
  lookout: { answers: boolean };
  lookoutThings: { ribbon: { visible: boolean } };
  sky: { farLight: { visible: boolean } };
};

/** Where things stand, from the game's own code. */
type Spots = {
  stile: { x: number; z: number; foot: [number, number]; note: [number, number] };
  top: [number, number];
  post: [number, number];
  stool: [number, number];
  stone: [number, number];
  /** The yaw that looks from the stool to the far house. */
  face: number;
  turn: number;
  hilltop: number;
  cut: number;
  steps: { half: number; out: number };
  walker: number;
  shut: number;
};

const DAY = new Date("2026-09-26T11:00:00");
const NIGHT = new Date("2026-09-26T22:00:00");
/** The walker's eye over the ground (scene.ts EYE). */
const EYE = 1.05;
/** Words studied, not all known (dev/plan.ts): enough known for the first stile note (n05) but not the hill's (n08); and enough for n08. */
const SHUT = 400;
const OPEN = 800;
/** Known words that note n09 (the diary) and n12 (the far light answers) need (notes/es.ts). */
const N09 = 566;
const N12 = 865;

// On CI's software WebGL (~7 frames a second) the walk alone takes 10–20 s to open, and then the walking is played out in real time.
test.describe.configure({ timeout: 60_000 });

/** Open the walk for a demo learner: `words` studied, or `known:n` for one who knows exactly n words (dev/boot.ts). */
async function walkIn(page: Page, words: number | `known:${number}`, at = DAY): Promise<Spots> {
  await page.clock.setFixedTime(at);
  await page.setViewportSize({ width: 1280, height: 720 });
  // Low detail: software WebGL on CI draws it faster.
  await pinDetail(page, "low");
  await page.goto(`/?demo=es:${words}#/today`);
  await expect(page.getByRole("button", { name: "Walk in your garden" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  return page.evaluate(async () => {
    const stile = await import(/* @vite-ignore */ "/src/garden/stile.ts");
    const lookout = await import(/* @vite-ignore */ "/src/garden/lookout.ts");
    const world = await import(/* @vite-ignore */ "/src/garden/world.ts");
    const s = (window as unknown as { __garden: HillScene }).__garden;
    const at = stile.stileAt(s.layout as Parameters<typeof stile.stileAt>[0]);
    const hill = lookout.lookoutAt(at);
    return { stile: at, top: hill.top, post: hill.post, stool: hill.stool, stone: hill.stone, face: hill.face, turn: lookout.PATH_TURN, hilltop: lookout.HILLTOP_R, cut: lookout.CUT, steps: { half: stile.STEP.w / 2, out: stile.STEP.out }, walker: world.WALKER, shut: stile.BRAMBLES_IN };
  });
}

/** Stand at (x, z), facing `yaw` (−z is 0; a positive yaw turns left). */
const stand = (page: Page, x: number, z: number, yaw: number, pitch = 0) =>
  page.evaluate((at) => Object.assign((window as unknown as { __garden: HillScene }).__garden, at), { x, z, yaw, pitch });

const where = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __garden: HillScene }).__garden;
    return { x: s.x, z: s.z, y: s.camera.position.y };
  });

const gameTime = (page: Page) => page.evaluate(() => (window as unknown as { __garden: HillScene }).__garden.elapsed);

/** Wait until the garden has run `s` seconds: by its own clock, not the test's, so a slow machine's few frames still cover the same ground (#790). */
async function waitGame(page: Page, s: number) {
  const from = await gameTime(page);
  // timeout 0: no wall-clock bound, as in holdUntil; the test's own timeout backs it. A frame counts at most 0.1 s (scene.ts MAX_FRAME), so on a CI runner drawing 3–4 frames a second the game runs at a third of the wall clock's speed (#871).
  await expect.poll(async () => (await gameTime(page)) - from, { intervals: [20], timeout: 0 }).toBeGreaterThanOrEqual(s);
}

/** Hold a key for `s` seconds of the garden's time. */
async function hold(page: Page, key: string, s: number) {
  await page.keyboard.down(key);
  await waitGame(page, s);
  await page.keyboard.up(key);
}

/** When to let go: once the view's height, z, or the distance from a point (x, z) is above or below a value. */
type Until = { of: "y" | "z" | [number, number]; above?: number; below?: number };

/**
 * Hold a key until `until` holds, then let go. The page lets go itself, on the
 * first frame it holds: a slow machine moves far in a frame, so a key up from
 * the test, frames later, would overshoot (#790). It gives up after `budget`
 * seconds of the garden's time, not the test's: CI draws about 7 frames a second,
 * so a long walk takes far longer there by the wall clock (#793).
 */
async function holdUntil(page: Page, key: string, until: Until, budget = 20) {
  await page.evaluate(
    ({ key, until, budget }) => {
      const w = window as unknown as { __garden: HillScene; __letGo: "walking" | "there" | "gave up" };
      w.__letGo = "walking";
      let from = 0;
      const check = () => {
        const s = w.__garden;
        const v = until.of === "y" ? s.camera.position.y : until.of === "z" ? s.z : Math.hypot(s.x - until.of[0], s.z - until.of[1]);
        const there = (until.above !== undefined && v > until.above) || (until.below !== undefined && v < until.below);
        if (there || s.elapsed - from > budget) {
          window.dispatchEvent(new KeyboardEvent("keyup", { code: key }));
          w.__letGo = there ? "there" : "gave up";
        } else requestAnimationFrame(check);
      };
      // Checked from the key down on: a key up before it would be lost, and the walker would walk on.
      window.addEventListener("keydown", (e) => e.code === key && ((from = w.__garden.elapsed), requestAnimationFrame(check)), { once: true });
    },
    { key, until, budget },
  );
  await page.keyboard.down(key);
  // timeout 0: the game-time budget above ends the wait, and the test's own timeout backs it.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __letGo: string }).__letGo), { intervals: [20], timeout: 0 }).not.toBe("walking");
  expect(await page.evaluate(() => (window as unknown as { __letGo: string }).__letGo)).toBe("there");
  // The page's key up was not the keyboard's: let go of it there too.
  await page.keyboard.up(key);
}

/** Two seconds without a key held: place and height have not changed. */
async function staysPut(page: Page) {
  const before = await where(page);
  await waitGame(page, 2);
  const after = await where(page);
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.01);
  expect(Math.abs(after.y - before.y)).toBeLessThan(0.01);
}

test("fence.solid: walking into the back fence away from the stile stops you at it", async ({ page }) => {
  const s = await walkIn(page, OPEN);
  await stand(page, s.stile.x + 2.5, s.stile.z + 1.5, 0);
  await hold(page, "KeyW", 1.5);
  const p = await where(page);
  expect(p.z).toBeCloseTo(s.stile.z + s.walker, 2);
});

test("stile.shut: before n08, the brambles in front of the stile stop you, and no button offers a way over", async ({ page }) => {
  const s = await walkIn(page, SHUT);
  await stand(page, s.stile.x, s.stile.foot[1] + 1, 0);
  await hold(page, "KeyW", 1.5);
  const p = await where(page);
  expect(p.z).toBeCloseTo(s.stile.z + s.shut + s.walker, 2);
  expect(Math.abs(p.y - EYE)).toBeLessThan(0.05);
  await expect(page.getByRole("button", { name: /climb|over|stile|hill/i })).toHaveCount(0);
});

test("stile.notes: by the notes at the stile, Read the note opens them one at a time", async ({ page }) => {
  const s = await walkIn(page, OPEN);
  await stand(page, s.stile.foot[0], s.stile.foot[1], 0, -0.3);
  const read = page.getByRole("button", { name: "Read the note", exact: true });
  const card = page.getByRole("dialog", { name: "A note from the gardener" });
  const seen: string[] = [];
  await expect(read).toBeVisible();
  while (await read.isVisible()) {
    await read.click();
    await expect(card).toBeVisible();
    seen.push((await card.textContent()) ?? "");
    await card.getByRole("button", { name: "Close" }).click();
    await expect(card).toBeHidden();
  }
  expect(seen.length).toBeGreaterThan(1);
  expect(new Set(seen).size).toBe(seen.length);
  // All read: nothing left in reach, so no button.
  await expect(page.locator(".gw-act")).toHaveCount(0);
});

test("a drag to look round leaves the note open, and then Escape closes the note, not the walk (#874)", async ({ page }) => {
  const s = await walkIn(page, OPEN);
  await stand(page, s.stile.foot[0], s.stile.foot[1], 0, -0.3);
  await page.getByRole("button", { name: "Read the note", exact: true }).click();
  const card = page.getByRole("dialog", { name: "A note from the gardener" });
  await expect(card).toBeVisible();
  // The press lands on the scene, so the card loses focus.
  await page.mouse.move(300, 300);
  await page.mouse.down();
  await page.mouse.move(450, 300, { steps: 5 });
  await page.mouse.up();
  await expect(card).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible();
});

test("Next plant replaces an open note; closing the plant's card brings back neither (#875)", async ({ page }) => {
  const s = await walkIn(page, OPEN);
  await stand(page, s.stile.foot[0], s.stile.foot[1], 0, -0.3);
  await page.getByRole("button", { name: "Read the note", exact: true }).click();
  const note = page.getByRole("dialog", { name: "A note from the gardener" });
  await expect(note).toBeVisible();
  await page.getByRole("button", { name: "Next plant" }).focus();
  await page.keyboard.press("Enter");
  const plant = page.getByRole("dialog", { name: /^The plant for / });
  await expect(plant).toBeVisible();
  await expect(note).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(plant).toBeHidden();
  await expect(note).toBeHidden();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible();
});

test("stile.walk-over: with n08, holding W takes you up the steps, over the top board and down past the fence", async ({ page }) => {
  const s = await walkIn(page, OPEN);
  await stand(page, s.stile.x, s.stile.foot[1], 0);
  // Up: the view rises to the top board's height.
  await holdUntil(page, "KeyW", { of: "y", above: EYE + 0.7 });
  await holdUntil(page, "KeyW", { of: "z", below: s.stile.z - s.steps.out - 0.3 });
  const p = await where(page);
  // Down on the far side, on the old path.
  expect(p.y).toBeLessThan(EYE + 0.5);
});

test("stile.stop-on-steps: with n08, let go of W on the top board and you stay there", async ({ page }) => {
  const s = await walkIn(page, OPEN);
  await stand(page, s.stile.x, s.stile.foot[1], 0);
  await holdUntil(page, "KeyW", { of: "z", below: s.stile.z + 0.15 });
  const p = await where(page);
  expect(Math.abs(p.z - s.stile.z)).toBeLessThan(s.steps.out);
  expect(p.y).toBeGreaterThan(EYE + 0.4);
  await staysPut(page);
});

test("stile.slide-on: with n08, walking into the front of the steps a little to one side puts you on them", async ({ page }) => {
  const s = await walkIn(page, OPEN);
  await stand(page, s.stile.x + s.steps.half - 0.1, s.stile.foot[1], 0);
  await holdUntil(page, "KeyW", { of: "z", below: s.stile.z - s.steps.out });
  const p = await where(page);
  expect(Math.abs(p.x - s.stile.x)).toBeLessThan(s.steps.half);
});

test("stile.sides-solid: with n08, the stile stops you along the fence, and a rail stops you on the steps", async ({ page }) => {
  const s = await walkIn(page, OPEN);
  // Along the back fence toward the stile, with D (+x).
  await stand(page, s.stile.x - 2, s.stile.z + s.walker + 0.05, 0);
  await hold(page, "KeyD", 1.5);
  let p = await where(page);
  expect(p.x).toBeCloseTo(s.stile.x - s.steps.half - s.walker, 2);
  // On the steps, with D: the rail.
  await stand(page, s.stile.x, s.stile.z + 0.3, 0);
  await hold(page, "KeyD", 1);
  p = await where(page);
  expect(p.x).toBeCloseTo(s.stile.x + s.steps.half - s.walker, 2);
  expect(p.z).toBeCloseTo(s.stile.z + 0.3, 2);
});

test("hill.walk-up: with n08, holding W along the old path takes you up to the hilltop, and the view rises with the ground", async ({ page }) => {
  const s = await walkIn(page, OPEN);
  await stand(page, s.stile.x, s.stile.foot[1], s.turn);
  await holdUntil(page, "KeyW", { of: s.top, below: 1.5 });
  const p = await where(page);
  expect(p.y).toBeGreaterThan(EYE + 2);
});

test("hill.brambles: on the cut way and on the hilltop, walking into the brambles stops you", async ({ page }) => {
  const s = await walkIn(page, OPEN);
  // On the hilltop, straight out.
  await stand(page, s.top[0], s.top[1], 0);
  await hold(page, "KeyW", 2.5);
  let p = await where(page);
  expect(Math.hypot(p.x - s.top[0], p.z - s.top[1])).toBeCloseTo(s.hilltop - s.walker, 2);
  // On the cut way, 3 m past the fence, walking square to it, to the left.
  const [dx, dz] = [-Math.sin(s.turn), -Math.cos(s.turn)];
  const [mx, mz] = [s.stile.x + dx * 3, s.stile.z + dz * 3];
  await stand(page, mx, mz, s.turn + Math.PI / 2);
  await hold(page, "KeyW", 1.5);
  p = await where(page);
  // How far it went across the way: its left is (dz, −dx).
  expect((p.x - mx) * dz - (p.z - mz) * dx).toBeCloseTo(s.cut - s.walker, 2);
});

test("hill.walk-back: from the hilltop, walking back down the path takes you over the stile into the garden, and you stay where you stop", async ({ page }) => {
  const s = await walkIn(page, OPEN);
  // Facing back toward the stile.
  await stand(page, s.top[0], s.top[1], s.turn + Math.PI);
  await holdUntil(page, "KeyW", { of: "z", above: s.stile.z + 1 });
  const p = await where(page);
  expect(Math.abs(p.y - EYE)).toBeLessThan(0.05);
  await staysPut(page);
});

test("hill.tap: tapping the hill's ground past the fence walks you there, over the stile", async ({ page }) => {
  const s = await walkIn(page, OPEN);
  await stand(page, s.stile.x, s.stile.foot[1], s.turn, -0.05);
  // A spot on the old path up the hill, 7 m out, on the screen.
  const to = { x: s.stile.x - Math.sin(s.turn) * 7, z: s.stile.z - Math.cos(s.turn) * 7 };
  const at = await page.evaluate(async (to) => {
    const { hillY, lookoutAt } = await import(/* @vite-ignore */ "/src/garden/lookout.ts");
    const { stileAt } = await import(/* @vite-ignore */ "/src/garden/stile.ts");
    const s = (window as unknown as { __garden: HillScene & { tmp: { constructor: new (x: number, y: number, z: number) => { project(c: unknown): { x: number; y: number } } } } }).__garden;
    const hill = lookoutAt(stileAt(s.layout as Parameters<typeof stileAt>[0]));
    const v = new s.tmp.constructor(to.x, hillY(hill, to.x, to.z), to.z).project(s.camera);
    const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height] as const;
  }, to);
  await page.mouse.click(...at);
  await expect.poll(async () => {
    const p = await where(page);
    return Math.hypot(p.x - to.x, p.z - to.z);
  }, { intervals: [100], timeout: 15_000 }).toBeLessThan(0.3);
});

/** The way a walker on the stool faces (to the far house), and the stool's left (toward the post), as [x, z]. */
const facing = (s: Spots) => {
  const [fx, fz] = [-Math.sin(s.face), -Math.cos(s.face)];
  return { ahead: [fx, fz], left: [fz, -fx] };
};

/** Just behind the stool, facing the far house over it. */
function byStool(page: Page, s: Spots) {
  const { ahead } = facing(s);
  return stand(page, s.stool[0] - ahead[0] * 0.6, s.stool[1] - ahead[1] * 0.6, s.face);
}

/** On the post's far side from the stool, facing the post. */
function byPost(page: Page, s: Spots) {
  const { left } = facing(s);
  return stand(page, s.post[0] + left[0] * 0.6, s.post[1] + left[1] * 0.6, Math.atan2(left[0], left[1]), -0.1);
}

/** Just behind the diary's stone, looking down at it. */
function byStone(page: Page, s: Spots) {
  const { ahead } = facing(s);
  return stand(page, s.stone[0] - ahead[0] * 0.6, s.stone[1] - ahead[1] * 0.6, s.face, -0.3);
}

const lapse = (page: Page) => page.evaluate(() => (window as unknown as { __garden: HillScene }).__garden.lapse);
const seated = (page: Page) => page.evaluate(() => (window as unknown as { __garden: HillScene }).__garden.walker.kind === "seated");
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** Sit on the stool, from just behind it. */
async function sit(page: Page, s: Spots) {
  await byStool(page, s);
  await button(page, "Sit on the stool").click();
  await expect.poll(() => seated(page)).toBe(true);
}

/** Blow the lantern out and light it again: one signal. */
async function signal(page: Page) {
  await button(page, "Blow out the lantern").click();
  await button(page, "Light the lantern").click();
  await expect(button(page, "Blow out the lantern")).toBeVisible();
}

/**
 * From now on, record whether the far light shows, on every frame: a slow
 * machine's poll could miss a second dark (#790). It is polled on first: the
 * sky sets it on its first dark frame (#707).
 */
async function recordFarLight(page: Page) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __garden: HillScene }).__garden.sky.farLight.visible)).toBe(true);
  await page.evaluate(() => {
    const w = window as unknown as { __garden: HillScene; __far?: boolean[] };
    const track = () => {
      w.__far!.push(w.__garden.sky.farLight.visible);
      requestAnimationFrame(track);
    };
    if (!w.__far) requestAnimationFrame(track);
    w.__far = [];
  });
}

/** Since recordFarLight: how many times the far light went dark, and whether it shows now. */
const farLight = (page: Page) =>
  page.evaluate(() => {
    const f = (window as unknown as { __far: boolean[] }).__far;
    return { dark: f.filter((on, i) => i > 0 && f[i - 1] && !on).length, on: f.at(-1) };
  });

test("hill.lantern: at night by the lantern's post, Blow out the lantern puts its flame out, and the button says Light the lantern", async ({ page }) => {
  const s = await walkIn(page, OPEN, NIGHT);
  await byPost(page, s);
  await button(page, "Blow out the lantern").click();
  await expect(button(page, "Light the lantern")).toBeVisible();
  expect(await page.evaluate(() => (({ on, lookout }) => on[lookout])((window as unknown as { __garden: HillScene }).__garden.lanterns))).toBe(false);
});

test("hill.sit: by the stool, Sit on the stool seats you facing the far house, and W stands you up", async ({ page }) => {
  const s = await walkIn(page, OPEN);
  // Behind the stool, turned away from the far house: sitting turns you to it.
  const { ahead } = facing(s);
  await stand(page, s.stool[0] - ahead[0] * 0.6, s.stool[1] - ahead[1] * 0.6, s.face + 1);
  await button(page, "Sit on the stool").click();
  await expect.poll(() => seated(page)).toBe(true);
  const sat = await page.evaluate(() => (({ x, z, yaw }) => ({ x, z, yaw }))((window as unknown as { __garden: HillScene }).__garden));
  expect(Math.hypot(sat.x - s.stool[0], sat.z - s.stool[1])).toBeLessThan(0.01);
  expect(sat.yaw).toBeCloseTo(s.face, 3);
  // The view narrows as you sit down.
  await expect.poll(() => page.evaluate(() => (window as unknown as { __garden: HillScene }).__garden.camera.fov)).toBeLessThan(55);
  await expect(button(page, "Stand up")).toBeVisible();
  await hold(page, "KeyW", 0.3);
  expect(await seated(page)).toBe(false);
});

test("hill.sit-night: by day, sitting on the stool brings dusk and its lit lantern within a minute, then night that holds; standing, time runs back", async ({ page }) => {
  // About half a minute of the garden's time to night and half a minute held: far longer on CI's few frames, where a slow runner's game runs at a third of the clock's speed (#871).
  test.setTimeout(360_000);
  const s = await walkIn(page, OPEN);
  await sit(page, s);
  const from = await gameTime(page);
  await expect(button(page, "Blow out the lantern")).toBeVisible({ timeout: 120_000 });
  expect((await gameTime(page)) - from).toBeLessThan(60);
  // From a day, the time-lapse's night.
  await expect.poll(() => lapse(page), { timeout: 120_000 }).toBe(2);
  await waitGame(page, 30);
  expect(await lapse(page)).toBe(2);
  expect(await seated(page)).toBe(true);
  await hold(page, "KeyW", 0.3);
  await expect.poll(() => lapse(page), { timeout: 30_000 }).toBe(0);
});

test("hill.diary: with n09, by the stone, Read the diary opens it on n09; before n09 there is no diary", async ({ page }) => {
  let s = await walkIn(page, `known:${N09 - 1}`);
  await byStone(page, s);
  // A second for the button to come, if it would.
  await waitGame(page, 1);
  await expect(button(page, "Read the diary")).toHaveCount(0);
  s = await walkIn(page, `known:${N09}`);
  await byStone(page, s);
  await button(page, "Read the diary").click();
  await expect(page.getByRole("dialog", { name: "A page of the gardener's diary, page 1 of 1" })).toContainText("El lucero: alguien que no me habla.");
});

test("hill.diary-new: with a page not read, the diary shows its ribbon and opens on it; read, the ribbon is gone", async ({ page }) => {
  // n12 not read yet; the eight pages before it read.
  const s = await walkIn(page, `known:${N12}`);
  const ribbon = () => page.evaluate(() => (window as unknown as { __garden: HillScene }).__garden.lookoutThings.ribbon.visible);
  expect(await ribbon()).toBe(true);
  await byStone(page, s);
  await button(page, "Read the diary").click();
  const card = page.getByRole("dialog", { name: "A page of the gardener's diary, page 9 of 9" });
  await expect(card).toContainText("Anoche hice dos señales con la luz.");
  await card.getByRole("button", { name: "Close" }).click();
  await expect(card).toBeHidden();
  expect(await ribbon()).toBe(false);
});

test("hill.no-answer: at night before n12, two signals leave the far light shining", async ({ page }) => {
  const s = await walkIn(page, OPEN, NIGHT);
  expect(await page.evaluate(() => (window as unknown as { __garden: HillScene }).__garden.lookout.answers)).toBe(false);
  await byPost(page, s);
  await recordFarLight(page);
  await signal(page);
  await signal(page);
  // Longer than an answer would take.
  await waitGame(page, 8);
  expect(await farLight(page)).toEqual({ dark: 0, on: true });
});

test("hill.answer: with n12, by day, sat on the stool till night, two signals from the seat get two blinks and the line; two more, another answer", async ({ page }) => {
  // About half a minute of the garden's time to night, then two rounds of signals: far longer on CI's few frames, where a slow runner's game runs at a third of the clock's speed (#871).
  test.setTimeout(360_000);
  const s = await walkIn(page, `known:${N12}`);
  await sit(page, s);
  await expect.poll(() => lapse(page), { timeout: 120_000 }).toBe(2);
  const line = page.locator(".gw-echo", { hasText: "El lucero contesta." });
  for (let round = 0; round < 2; round++) {
    await recordFarLight(page);
    await signal(page);
    expect(await farLight(page)).toEqual({ dark: 0, on: true });
    await signal(page);
    await expect(line).toBeVisible({ timeout: 20_000 });
    // The answer is over 6 s after the signal, and its line gone 5 s after it showed.
    await waitGame(page, 8);
    await expect(line).toBeHidden();
    expect(await farLight(page)).toEqual({ dark: 2, on: true });
  }
  expect(await seated(page)).toBe(true);
});
