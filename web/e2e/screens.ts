// The named screens of the app (#699, #977): one list for the screenshot script (shots.ts)
// and the check for mechanical UI faults (ui-faults.spec.ts). To add a screen, add an entry.

import { reveal, startSession } from "./helpers";
import { openToday } from "./spots";
import { expect, type Locator, type Page } from "./test";

/**
 * Show the answer of the card on screen, whatever its kind: a writing card is checked with a wrong word.
 * (The 30-word learner's first card is a writing card now: `reveal` alone timed out on it, and the
 * answer and summary pictures were not made.)
 */
async function showAnswer(page: Page): Promise<"written" | "revealed"> {
  await expect(page.locator("main.card")).toBeVisible();
  const field = page.getByRole("textbox", { name: "Type the missing word" });
  if (!(await field.isVisible())) {
    await reveal(page);
    return "revealed";
  }
  await field.fill("x");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /^Next/ })).toBeVisible();
  return "written";
}

/**
 * Wait until a garden strip holds still. It fills in over a few frames after its screen shows
 * (the plants after paint, then the ones past the edges, the visitors and the scroll), so two
 * shots of the same code differed when one was taken before that: once with no plants in view (#1004).
 */
async function stillStrip(strip: Locator) {
  let last = "";
  await expect
    .poll(
      async () => {
        const now = await strip.evaluate((el) => {
          const scroll = el.querySelector(".garden-scroll");
          if (scroll === null) throw new Error("a garden strip with no .garden-scroll");
          // Each plant stands at its foot by its CSS `translate`, which the sway does not move.
          const feet = [...el.querySelectorAll("svg > .sway")].map((p) => getComputedStyle(p).translate);
          return feet.length === 0 ? "" : JSON.stringify([scroll.scrollLeft, scroll.scrollWidth, feet]);
        });
        const still = now !== "" && now === last;
        last = now;
        return still;
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe(true);
}

/** Screens of the app, each reached from a fresh demo learner with 30 words. */
export const SCREENS: Record<string, (page: Page) => Promise<void>> = {
  today: async (page) => {
    await openToday(page, "es:30");
    await stillStrip(page.getByTestId("today-garden"));
  },
  card: async (page) => {
    await SCREENS.today(page);
    await startSession(page);
  },
  answer: async (page) => {
    await SCREENS.card(page);
    await showAnswer(page);
  },
  summary: async (page) => {
    await SCREENS.card(page);
    // A click on Next, not Enter again: a second Enter soon after the first is taken as a double press and dropped (Session.tsx useReveal).
    if ((await showAnswer(page)) === "written") await page.getByRole("button", { name: /^Next/ }).click();
    else await page.keyboard.press("1");
    await page.getByRole("button", { name: "End session" }).click();
    await expect(page.locator("main.summary")).toBeVisible();
    await stillStrip(page.locator("main.summary .garden"));
  },
  words: async (page) => {
    await page.goto("/?demo=es:30#/words");
    await expect(page.locator(".word-row").first()).toBeVisible({ timeout: 20_000 });
    // The deck's sentences come after its words, and then the progress line grows (#1004).
    // The 30-word learner can read one, so the line always gets this part.
    await expect(page.getByText(/You can read \d+ sentences? from the course/)).toBeVisible({ timeout: 20_000 });
  },
  settings: async (page) => {
    await page.goto("/?demo=es:30#/settings");
    await expect(page.getByRole("tab", { name: "Settings", selected: true })).toBeVisible({ timeout: 20_000 });
    // The Course section comes when the learner has loaded, and pushes the rest down (#1004).
    await expect(page.getByRole("heading", { name: "Course" })).toBeVisible({ timeout: 20_000 });
  },
  // The story points to jump to (#751): no learner made.
  jump: async (page) => {
    await page.goto("/?demo");
    await expect(page.getByRole("heading", { name: "Jump to a story point" })).toBeVisible();
  },
};
