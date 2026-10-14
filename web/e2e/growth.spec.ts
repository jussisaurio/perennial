import { expect, test, type Page } from "@playwright/test";
import { advance, answer, kicker, reveal, startCourse } from "./helpers";

// #200: after a good answer the word's plant is planted or grows, and only then comes the next card.
test.use({ reducedMotion: "no-preference" });

const moment = (page: Page) => page.locator(".growth");
const cardId = (page: Page) => page.locator(".session").getAttribute("data-card");

test("a new word's seed is planted, then the next card; a tap skips the moment", async ({ page }) => {
  await page.clock.install();
  await startCourse(page);
  await page.locator("button.start").click();
  await reveal(page);
  const first = await cardId(page);
  await page.keyboard.press("1"); // New to me
  await expect(moment(page)).toHaveAttribute("data-kind", "plant");
  expect(await cardId(page)).toBe(first); // the card waits for the seed
  await expect(moment(page)).toHaveCount(0);
  await expect(page.locator(".session")).not.toHaveAttribute("data-card", first!);

  // With the clock stopped the moment cannot end by itself: only the tap ends it.
  await reveal(page);
  const second = await cardId(page);
  await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 1000));
  await page.keyboard.press("2"); // I knew it
  await expect(moment(page)).toBeVisible();
  await page.mouse.click(10, 10);
  await expect(moment(page)).toHaveCount(0);
  await expect(page.locator(".session")).not.toHaveAttribute("data-card", second!);
});

/** Stop the clock: from now on a moment cannot end by itself, so a card that moves on had none. */
async function freeze(page: Page) {
  await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 1000));
}

test("the key that skips the moment does not act on the next card", async ({ page }) => {
  await page.clock.install();
  await startCourse(page);
  await page.locator("button.start").click();
  await reveal(page);
  await freeze(page);
  const first = await cardId(page);
  await page.keyboard.press("1"); // New to me: the seed is planted
  await expect(moment(page)).toBeVisible();
  await page.keyboard.press("Space"); // skips it
  await expect(page.locator(".session")).not.toHaveAttribute("data-card", first!);
  await expect(moment(page)).toHaveCount(0);
  // The next new word still hides its meaning: that Space did not show it.
  await expect(page.getByRole("button", { name: /Show meaning/ })).toBeVisible();
  await expect(page.locator(".gloss")).toHaveCount(0);
});

test("a remembered quick check waters the plant; a forgotten one moves straight on", async ({ page }) => {
  await page.clock.install();
  await startCourse(page);
  await page.locator("button.start").click();
  for (let i = 0; i < 4; i++) await answer(page, "1"); // four seeds planted
  await expect(kicker(page)).toHaveText(/quick check/);
  await reveal(page);
  await page.keyboard.press("2"); // I remembered: seed → sprout
  await expect(moment(page)).toHaveAttribute("data-kind", "water");
  await expect(moment(page)).toHaveCount(0);
  await expect(kicker(page)).toHaveText(/quick check/);
  await reveal(page);
  await freeze(page);
  const forgot = await cardId(page);
  await page.keyboard.press("1"); // I forgot: nothing grows, so the card moves on with the clock stopped
  await expect(page.locator(".session")).not.toHaveAttribute("data-card", forgot!);
  await expect(moment(page)).toHaveCount(0);
});

test("the setting 'Next card right away' skips the moment", async ({ page }) => {
  await page.clock.install();
  await startCourse(page);
  await page.goto("/#/settings");
  await page.getByRole("radio", { name: "Next card right away" }).click();
  await page.goto("/");
  await page.locator("button.start").click();
  await reveal(page);
  await freeze(page);
  // New to me would plant the seed; with the clock stopped the card moves on only because no moment plays.
  await advance(page, "1");
  await expect(moment(page)).toHaveCount(0);
  await page.clock.resume();
  // It is kept for this device.
  await page.goto("/#/settings");
  await expect(page.getByRole("radio", { name: "Next card right away" })).toHaveAttribute("aria-checked", "true");
});

test("the summary replays what grew this chunk, then rests; a tap ends it (#216)", async ({ page }) => {
  await page.clock.install();
  await startCourse(page);
  await page.locator("button.start").click();
  await answer(page, "2"); // I knew it: a seed that springs up to a bud
  await expect(moment(page)).toHaveCount(0);
  await freeze(page);
  await page.getByRole("button", { name: "End session" }).click();
  const garden = page.locator("main.summary .garden");
  await expect(garden).toHaveAttribute("data-replaying", "true");
  // The plant's glow sits at its top: low while it regrows, high once it has.
  const glowTop = () => garden.locator("circle.glow").first().evaluate((c) => Number(c.getAttribute("cy")));
  const during = await glowTop();
  await page.clock.runFor(2_100);
  await expect(garden).not.toHaveAttribute("data-replaying", "true");
  expect(await glowTop()).toBeLessThan(during - 10); // SVG y grows downward: a taller plant has a smaller cy
  // Again, ended by a tap this time: the clock stays stopped, so only the tap can end it.
  await page.getByRole("button", { name: "Done" }).click();
  await page.locator("button.start").click();
  await page.clock.resume();
  await answer(page, "2");
  await expect(moment(page)).toHaveCount(0);
  await freeze(page);
  await page.getByRole("button", { name: "End session" }).click();
  await expect(garden).toHaveAttribute("data-replaying", "true");
  await page.mouse.click(5, 5);
  await expect(garden).not.toHaveAttribute("data-replaying", "true");
});

test("with 'Next card right away' the summary does not replay (#216)", async ({ page }) => {
  await startCourse(page);
  await page.goto("/#/settings");
  await page.getByRole("radio", { name: "Next card right away" }).click();
  await page.goto("/");
  await page.locator("button.start").click();
  await answer(page, "2");
  await page.getByRole("button", { name: "End session" }).click();
  const garden = page.locator("main.summary .garden");
  await expect(garden.locator("circle.glow")).toHaveCount(1);
  await expect(garden).not.toHaveAttribute("data-replaying", "true");
});

/** Counts notes started by the page's Web Audio, instead of playing them. */
async function countNotes(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { notes: number; AudioContext: unknown };
    w.notes = 0;
    const Real = window.AudioContext;
    w.AudioContext = class extends Real {
      createOscillator() {
        const o = super.createOscillator();
        const start = o.start.bind(o);
        o.start = (when?: number) => {
          w.notes++;
          start(when);
        };
        return o;
      }
    };
  });
  return () => page.evaluate(() => (window as unknown as { notes: number }).notes);
}

test("a good answer chimes the word's note; a wrong one and sound off stay silent (#215)", async ({ page }) => {
  const notes = await countNotes(page);
  await startCourse(page);
  await page.locator("button.start").click();
  for (let i = 0; i < 4; i++) await answer(page, "1"); // four seeds planted: four chimes (two oscillators each)
  await expect.poll(notes).toBe(8);
  await expect(kicker(page)).toHaveText(/quick check/);
  await answer(page, "1"); // I forgot: no chime
  expect(await notes()).toBe(8);
  await page.getByRole("button", { name: "Mute sound" }).click();
  await reveal(page);
  await page.keyboard.press("2"); // remembered: the plant is watered, but the sound is off
  await expect(moment(page)).toHaveAttribute("data-kind", "water");
  await expect(moment(page)).toHaveCount(0);
  expect(await notes()).toBe(8);
});
