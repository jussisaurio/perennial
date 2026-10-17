import { expect, test, type Page } from "./test";

// #357, plants answer back: shake a plant and its word's other forms fall as
// petals, written on them; a word with no other forms drops one leaf. Each noun
// plant's label has a stake whose top shows the noun's gender.

type Plant = { id: string; lemma: string; pos: string; forms: string[]; gender?: string; x: number; z: number; growth: number };
type ShakeScene = {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  camera: unknown;
  tmp: { constructor: new (x: number, y: number, z: number) => { project(c: unknown): { x: number; y: number } } };
  layout: { plants: Plant[] };
};

async function openWalk(page: Page, demo = "es:30") {
  await page.goto(`/?demo=${demo}#/today`);
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
}

/** Stand 1.2 m in front of the plant for `lemma`, facing it, and return where its stem shows on the page (pixels), once a frame has drawn it there. */
const standBy = (page: Page, lemma: string) =>
  page.evaluate(
    (lemma) => {
      const s = (window as unknown as { __garden: ShakeScene }).__garden;
      const p = s.layout.plants.find((q) => q.lemma === lemma)!;
      // Forward is -z at yaw 0.
      Object.assign(s, { x: p.x, z: p.z + 1.2, yaw: 0, pitch: -0.3 });
      return new Promise<[number, number]>((done) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const v = new s.tmp.constructor(p.x, 0.5, p.z).project(s.camera);
            const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
            done([r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]);
          }),
        ),
      );
    },
    lemma,
  );

const status = (page: Page) => page.locator(".gw > [role=status]");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  // Low quality: software WebGL on CI draws it faster, and every click waits for frames.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
});

test("the action button shakes the plant ahead: ser's forms fall as petals, and a screen reader hears them", async ({ page }) => {
  await openWalk(page);
  await standBy(page, "ser");
  const shake = page.getByRole("button", { name: "Shake the plant" });
  // An icon only (#334): the name is for screen readers.
  await expect(shake).toHaveText("");
  await shake.click();
  const petals = page.locator(".gw-petal");
  await expect(petals.filter({ hasText: /^soy$/ })).toBeVisible();
  await expect(petals.filter({ hasText: /^eres$/ })).toBeVisible();
  await expect(petals).toHaveCount(8);
  // The word itself never falls.
  await expect(petals.filter({ hasText: /^ser$/ })).toHaveCount(0);
  await expect(status(page)).toHaveText("ser shakes. Petals fall: soy, eres, es, somos, sois, son, era, eras.");
  // They settle and fade, and are gone.
  await expect(petals).toHaveCount(0, { timeout: 10_000 });
});

test("a long press on a word with no other forms drops one leaf, and opens no card", async ({ page }) => {
  await openWalk(page);
  const [x, y] = await standBy(page, "y");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(page.locator(".gw-petal svg")).toBeVisible();
  await page.mouse.up();
  await expect(status(page)).toHaveText("y shakes. One leaf falls.");
  await expect(page.locator(".gw-petal")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a noun's label stake has a top shaped by its gender, the same for the same gender; other words' labels have none", async ({ page }) => {
  // The first German nouns: der Mann, das Leben, die Zeit, der Gott.
  await openWalk(page, "de:110");
  const stake = async (lemma: string) => {
    await standBy(page, lemma);
    const label = page.locator(".gw-label", { hasText: new RegExp(`^${lemma}$`) });
    await expect(label).toBeVisible();
    return (await label.locator("svg.gw-stake").evaluateAll((els) => els.map((e) => e.innerHTML)))[0] ?? null;
  };
  const mann = await stake("Mann");
  expect(mann).not.toBeNull();
  expect(await stake("Gott")).toBe(mann);
  expect(new Set([mann, await stake("Leben"), await stake("Zeit")]).size).toBe(3);
  expect(await stake("sein")).toBeNull();
});
