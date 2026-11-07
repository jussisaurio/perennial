import { addEmail, startCourse } from "./helpers";
import { expect, test } from "./test";

// #682: Sign out in Settings showed the landing page, then reloaded: a blank
// page and the loading screen, then the landing page again.
test("signing out goes from Settings straight to the landing page", async ({ page, context }) => {
  // Each screen the page shows, in order: its h1, or Loading. Kept in sessionStorage,
  // so a reload adds to the list; each new document logs too, once started.
  await context.addInitScript(() => {
    const screen = () => {
      if (document.querySelector('[role="status"][aria-label="Loading"]')) return "Loading";
      // The landing page's h1 has a no-break space.
      return document.querySelector("h1")?.textContent?.replace(/\s+/g, " ").trim() ?? "blank";
    };
    const start = () => {
      const log = () => {
        const seen = JSON.parse(sessionStorage.getItem("screens") ?? "[]") as string[];
        const now = screen();
        if (seen.at(-1) !== now) sessionStorage.setItem("screens", JSON.stringify([...seen, now]));
      };
      log();
      // The document, not its root element: a new document may not have one yet.
      new MutationObserver(log).observe(document, { childList: true, subtree: true, characterData: true });
    };
    (window as unknown as { logScreens: () => void }).logScreens = () => {
      sessionStorage.setItem("screens", "[]");
      start();
    };
    if (sessionStorage.getItem("screens") !== null) start();
  });
  await startCourse(page);
  await addEmail(page);
  await page.evaluate(() => (window as unknown as { logScreens: () => void }).logScreens());
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("button", { name: /Start learning/ })).toBeVisible();
  // The old reload came right after the landing page first showed: give it time to show up in the list.
  await page.waitForTimeout(1500);
  const screens = await page.evaluate(() => sessionStorage.getItem("screens"));
  expect(JSON.parse(screens ?? "null")).toEqual(["Settings", "Grow a language, 5 minutes a day."]);
});
