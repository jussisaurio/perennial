import { expect, test, type Page } from "./test";
import { pinDetail } from "./helpers";

// The back fence, the stile and the hill (#770, docs/garden-play.md "Back
// fence, stile and hill"): one test per claim, played with the keys and a tap
// as the learner would. Only where the learner stands at the start is set by
// hand. Until note n08 (620 known words) brambles shut the stile; after it you
// walk over and up the hill. The clock is pinned to a day, or a night for the
// lantern; the viewport to a laptop's.

/** The parts of the dev-only scene handle (window.__garden) these tests read and move. */
type HillScene = {
  layout: object;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  camera: { position: { y: number } };
  elapsed: number;
  lookout: { answers: boolean; lift(now: number): number };
  sky: { farLight: { visible: boolean } };
};

/** Where things stand, from the game's own code. */
type Spots = {
  stile: { x: number; z: number; foot: [number, number]; note: [number, number] };
  top: [number, number];
  post: [number, number];
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
/** Words known: enough for the first stile note (n05) but not the hill's (n08); and enough for n08. */
const SHUT = 300;
const OPEN = 800;

// On CI's software WebGL (~7 frames a second) the walk alone takes 10–20 s to open, and then the walking is played out in real time.
test.describe.configure({ timeout: 60_000 });

async function walkIn(page: Page, words: number, at = DAY): Promise<Spots> {
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
    return { stile: at, top: hill.top, post: hill.post, turn: lookout.PATH_TURN, hilltop: lookout.HILLTOP_R, cut: lookout.CUT, steps: { half: stile.STEP.w / 2, out: stile.STEP.out }, walker: world.WALKER, shut: stile.BRAMBLES_IN };
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
  await expect.poll(async () => (await gameTime(page)) - from, { intervals: [20], timeout: 15_000 }).toBeGreaterThanOrEqual(s);
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
 * the test, frames later, would overshoot (#790).
 */
async function holdUntil(page: Page, key: string, until: Until, timeout = 15_000) {
  await page.evaluate(
    ({ key, until }) => {
      const w = window as unknown as { __garden: HillScene; __letGo: boolean };
      w.__letGo = false;
      const check = () => {
        const s = w.__garden;
        const v = until.of === "y" ? s.camera.position.y : until.of === "z" ? s.z : Math.hypot(s.x - until.of[0], s.z - until.of[1]);
        if ((until.above !== undefined && v > until.above) || (until.below !== undefined && v < until.below)) {
          window.dispatchEvent(new KeyboardEvent("keyup", { code: key }));
          w.__letGo = true;
        } else requestAnimationFrame(check);
      };
      // Checked from the key down on: a key up before it would be lost, and the walker would walk on.
      window.addEventListener("keydown", (e) => e.code === key && requestAnimationFrame(check), { once: true });
    },
    { key, until },
  );
  await page.keyboard.down(key);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __letGo: boolean }).__letGo), { intervals: [20], timeout }).toBe(true);
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
  await expect(page.getByRole("button", { name: "Call", exact: true })).toBeVisible();
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

/**
 * From now on, record the lantern's lift and whether the far light is on, on
 * every frame: a slow machine's poll could miss the lantern's 1.4 s up or a
 * blink's 0.3 s (#790).
 */
const recordLantern = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __garden: HillScene; __lantern?: [number, boolean][] };
    const track = () => {
      w.__lantern!.push([w.__garden.lookout.lift(w.__garden.elapsed), w.__garden.sky.farLight.visible]);
      requestAnimationFrame(track);
    };
    if (!w.__lantern) requestAnimationFrame(track);
    w.__lantern = [];
  });

/** Since recordLantern: the highest lift, whether the far light went out, and the lift and far light on the last frame. */
const lantern = (page: Page) =>
  page.evaluate(() => {
    const l = (window as unknown as { __lantern: [number, boolean][] }).__lantern;
    const last = l.at(-1);
    return { top: Math.max(...l.map(([lift]) => lift)), wentOut: l.some(([, far]) => !far), lift: last?.[0], far: last?.[1] };
  });

/** On the hilltop by the lantern's post, at night, having walked up from the stile's foot. */
async function upToThePost(page: Page) {
  const s = await walkIn(page, OPEN, NIGHT);
  await stand(page, s.stile.x, s.stile.foot[1], s.turn);
  await holdUntil(page, "KeyW", { of: s.top, below: 0.6 });
  // Facing the post, ahead on the left.
  await stand(page, s.top[0], s.top[1], Math.atan2(-(s.post[0] - s.top[0]), -(s.post[1] - s.top[1])));
}

test("hill.raise: at night by the lantern's post, Raise the lantern lifts it, says so, and it comes back down", async ({ page }) => {
  await upToThePost(page);
  await recordLantern(page);
  await page.getByRole("button", { name: "Raise the lantern", exact: true }).click();
  await expect(page.locator(".sr-only[role=status]")).toContainText("You raise the lantern");
  await expect.poll(async () => (await lantern(page)).top, { intervals: [50], timeout: 5_000 }).toBeGreaterThan(0.9);
  await expect.poll(async () => (await lantern(page)).lift, { intervals: [50], timeout: 10_000 }).toBe(0);
});

// #683, kept from the lookout's old test.
test("hill.far-light: before n12 it shines on; once it answers, the first raise gets two blinks, and later ones none", async ({ page }) => {
  await upToThePost(page);
  const status = page.locator(".sr-only[role=status]");
  const raise = page.getByRole("button", { name: "Raise the lantern", exact: true });
  // Polled: the sky sets it on its first frame, which may not have run yet (#707).
  await recordLantern(page);
  await expect.poll(async () => (await lantern(page)).far, { intervals: [50], timeout: 5_000 }).toBe(true);
  // This learner may have n12: the test says which.
  await page.evaluate(() => ((window as unknown as { __garden: HillScene }).__garden.lookout.answers = false));
  await raise.click();
  await expect(status).toHaveText("You raise the lantern. Far away, a small light shines.");
  await page.evaluate(() => ((window as unknown as { __garden: HillScene }).__garden.lookout.answers = true));
  await recordLantern(page);
  await raise.click();
  await expect(status).toHaveText("You raise the lantern. Far away, the small light blinks twice.");
  await expect.poll(async () => (await lantern(page)).wentOut, { intervals: [50], timeout: 5_000 }).toBe(true);
  await expect.poll(async () => (await lantern(page)).far, { intervals: [50], timeout: 5_000 }).toBe(true);
  await raise.click();
  await expect(status).toHaveText("You raise the lantern. Far away, a small light shines.");
});
