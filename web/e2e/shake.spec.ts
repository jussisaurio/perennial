import { expect, test, type Page } from "./test";
import { pinDetail, type Drawn } from "./helpers";

// #357, plants answer back: shake a plant and its word's other forms fall as
// petals, written on them; a word with no other forms drops one leaf. Each noun
// plant's label has a stake whose top shows the noun's gender.

async function openWalk(page: Page, demo = "es:30") {
  await page.goto(`/?demo=${demo}#/today`);
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
}

/** Stand 1.2 m in front of the plant for `lemma`, facing it, and return where its stem shows on the page (pixels), once a frame has drawn it there. */
const standBy = (page: Page, lemma: string, pitch = -0.3) =>
  page.evaluate(
    ([lemma, pitch]) => {
      const g = window.__garden.game;
      const s = window.__garden as unknown as Drawn;
      const p = g.layout.plants.find((q) => q.lemma === lemma)!;
      // Forward is -z at yaw 0.
      Object.assign(g.me, { x: p.x, z: p.z + 1.2, yaw: 0, pitch });
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
    [lemma, pitch] as const,
  );

// The sr-only line, not the loading line: that is a status too while plants still stream in (#621).
const status = (page: Page) => page.locator(".gw > .sr-only[role=status]");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  // Low detail: software WebGL on CI draws it faster, and every click waits for frames.
  await pinDetail(page, "low");
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
  // A word with no other forms, in the bed's front row so no other plant stands in front of it (beds fill from the front, #641).
  const lemma = await page.evaluate(() => {
    const ps = window.__garden.game.layout.plants.filter((p) => p.forms.every((f) => f === p.lemma));
    return ps.reduce((a, b) => (b.z > a.z ? b : a)).lemma;
  });
  const [x, y] = await standBy(page, lemma);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(page.locator(".gw-petal svg")).toBeVisible();
  await page.mouse.up();
  await expect(status(page)).toHaveText(`${lemma} shakes. One leaf falls.`);
  await expect(page.locator(".gw-petal")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a noun's label stake has a top shaped by its gender, the same for the same gender; other words' labels have none", async ({ page }) => {
  // The first German nouns: der Mann, das Leben, die Zeit, der Gott.
  await openWalk(page, "de:110");
  const stake = async (lemma: string) => {
    // Looking straight ahead: looking down, a tall plant's label is above the view (sein, grown to 0.93 in the demo since #704).
    await standBy(page, lemma, 0);
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
