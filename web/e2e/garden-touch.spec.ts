import { expect, test, type Page } from "@playwright/test";
import { plantNearMiddle, settledGardenWidth } from "./helpers";

// Runs on the iPhone (WebKit) project only. Playwright's tap sends a whole tap
// in one go, so React never renders between touchdown and lift; a real finger
// holds for a moment. This taps in iOS order with that hold: over, enter and
// down; then up, out and leave (a touch leaves on lift); then the click.
async function fingerTap(page: Page, x: number, y: number) {
  await page.evaluate(
    async ([x, y]) => {
      const at = document.elementFromPoint(x, y)!;
      const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerType: "touch", pointerId: 2, isPrimary: true };
      const hold = () => new Promise((r) => setTimeout(r, 80));
      for (const t of ["pointerover", "pointerenter", "pointerdown"]) at.dispatchEvent(new PointerEvent(t, { ...o, bubbles: t !== "pointerenter" }));
      await hold();
      for (const t of ["pointerup", "pointerout", "pointerleave"]) at.dispatchEvent(new PointerEvent(t, { ...o, bubbles: t !== "pointerleave" }));
      await hold();
      // The click goes to whatever is under the finger now.
      document.elementFromPoint(x, y)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    },
    [x, y],
  );
}

test("iPhone: a tapped plant's card stays open, and its link opens the 3D garden (#113)", async ({ page }) => {
  await page.goto("/?demo=es#/today");
  await expect(page.locator(".garden.scrolls")).toBeVisible({ timeout: 30_000 });
  await settledGardenWidth(page);
  await fingerTap(page, ...(await plantNearMiddle(page)));
  const card = page.locator(".plant-tip");
  await expect(card).toBeVisible();
  const word = (await card.locator("strong").textContent())!;
  // Before #113 the lift closed the card, so this click fell through to the plant beneath.
  const link = (await card.locator("button").boundingBox())!;
  await fingerTap(page, link.x + link.width / 2, link.y + link.height / 2);
  await expect(page.getByRole("dialog", { name: `The plant for ${word}` })).toBeVisible({ timeout: 20_000 });
});
