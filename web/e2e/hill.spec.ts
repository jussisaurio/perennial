import { expect, test, type Page } from "./test";
import { pinDetail, type Drawn } from "./helpers";

// The back fence, the stile and the hill (#770, docs/garden-play.md "Back
// fence, stile and hill"): the claims that need a browser, played as the
// learner would. Where you can walk and what the stool and the lantern do are
// unit tests on the game (game.test.ts, walker.test.ts, #975); here are the note
// and diary cards, and a tap on raised ground. Only where the learner stands at
// the start is set by hand. The clock is pinned to a day; the viewport to a
// laptop's.

/** The renderer's parts these tests read: the game itself is window.__garden.game. */
type HillScene = Drawn & { lookoutThings: { ribbon: { visible: boolean } } };

/** Where things stand, from the game's own code. */
type Spots = {
  stile: { x: number; z: number; foot: [number, number] };
  stone: [number, number];
  /** The yaw that looks from the stool to the far house. */
  face: number;
  turn: number;
};

const DAY = new Date("2026-09-26T11:00:00");
/** Words studied, not all known (dev/plan.ts): enough known for note n08, which opens the stile. */
const OPEN = 800;
/** Known words that note n09 (the diary) and n12 (the far light answers) need (notes/es.ts). */
const N09 = 566;
const N12 = 887;

// On CI's software WebGL (~7 frames a second) the walk alone takes 10–20 s to open, and then the walking is played out in real time.
test.describe.configure({ timeout: 60_000 });

/** Open the walk for a demo learner: `words` studied, or `known:n` for one who knows exactly n words (dev/boot.ts). */
async function walkIn(page: Page, words: number | `known:${number}`): Promise<Spots> {
  await page.clock.setFixedTime(DAY);
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
    const at = stile.stileAt(window.__garden.game.layout);
    const hill = lookout.lookoutAt(at);
    return { stile: at, stone: hill.stone, face: hill.face, turn: lookout.PATH_TURN };
  });
}

/** Stand at (x, z), facing `yaw` (−z is 0; a positive yaw turns left). */
const stand = (page: Page, x: number, z: number, yaw: number, pitch = 0) =>
  page.evaluate((at) => Object.assign(window.__garden.game.me, at), { x, z, yaw, pitch });

const where = (page: Page) =>
  page.evaluate(() => {
    const me = window.__garden.game.me;
    return { x: me.x, z: me.z };
  });

const gameTime = (page: Page) => page.evaluate(() => window.__garden.game.elapsed);

/** Wait until the garden has run `s` seconds: by its own clock, not the test's, so a slow machine's few frames still cover the same ground (#790). */
async function waitGame(page: Page, s: number) {
  const from = await gameTime(page);
  // timeout 0: no wall-clock bound; the test's own timeout backs it. A frame counts at most 0.1 s (scene.ts MAX_FRAME), so on a CI runner drawing 3–4 frames a second the game runs at a third of the wall clock's speed (#871).
  await expect.poll(async () => (await gameTime(page)) - from, { intervals: [20], timeout: 0 }).toBeGreaterThanOrEqual(s);
}

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

test("hill.tap: tapping the hill's ground past the fence walks you there, over the stile", async ({ page }) => {
  const s = await walkIn(page, OPEN);
  await stand(page, s.stile.x, s.stile.foot[1], s.turn, -0.05);
  // A spot on the old path up the hill, 7 m out, on the screen.
  const to = { x: s.stile.x - Math.sin(s.turn) * 7, z: s.stile.z - Math.cos(s.turn) * 7 };
  const at = await page.evaluate(async (to) => {
    const { hillY, lookoutAt } = await import(/* @vite-ignore */ "/src/garden/lookout.ts");
    const { stileAt } = await import(/* @vite-ignore */ "/src/garden/stile.ts");
    const s = window.__garden as unknown as Drawn;
    const hill = lookoutAt(stileAt(window.__garden.game.layout));
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

/** Just behind the diary's stone, looking down at it, facing the far house. */
function byStone(page: Page, s: Spots) {
  const [fx, fz] = [-Math.sin(s.face), -Math.cos(s.face)];
  return stand(page, s.stone[0] - fx * 0.6, s.stone[1] - fz * 0.6, s.face, -0.3);
}

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

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
  const ribbon = () => page.evaluate(() => (window.__garden as unknown as HillScene).lookoutThings.ribbon.visible);
  expect(await ribbon()).toBe(true);
  await byStone(page, s);
  await button(page, "Read the diary").click();
  const card = page.getByRole("dialog", { name: "A page of the gardener's diary, page 9 of 9" });
  await expect(card).toContainText("Anoche hice dos señales con la luz.");
  await card.getByRole("button", { name: "Close" }).click();
  await expect(card).toBeHidden();
  expect(await ribbon()).toBe(false);
});
