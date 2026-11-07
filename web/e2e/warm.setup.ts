// Loads the landing page once before the other tests. A fresh dev server transforms each
// module on its first request, one import level after another. On a CI runner that first
// load took over 5 s, so the first test in a shard timed out on it (#610).
import { expect, test } from "./test";

test("warm the dev server", async ({ page }) => {
  // A one-time cost of the cold server, not of the app: this is the only test that pays it.
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Grow a language/ })).toBeVisible({ timeout: 55_000 });
  // The landing then fetches the other screens (ui/screens.ts): wait for them too.
  await page.waitForLoadState("networkidle");
});
