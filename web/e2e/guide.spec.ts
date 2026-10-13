import { expect, test, type Page } from "@playwright/test";
import { startCourse } from "./helpers";

// #211: the Words screen as a field guide. Known words are pressed flowers, words still growing are sketches.

/** Reviews as the app posts them: `known` words reviewed twice long ago (known now), `growing` once two days ago. */
async function history(page: Page, known: string[], growing: string[]) {
  await page.evaluate(
    async ({ known, growing }) => {
      const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
      const { loadDeck } = await import(/* @vite-ignore */ "/src/data/deck.ts");
      const deck = await loadDeck("es");
      const id = (l: string) => deck.words.find((w: { lemma: string }) => w.lemma === l)!.id;
      const row = (l: string, grade: number, days: number) => ({
        type: "review.insert",
        row: { id: crypto.randomUUID(), lang: "es", word_id: id(l), skill: "read", grade, kind: grade === 4 ? "known" : "review", reviewed_at: new Date(Date.now() - days * 86_400_000).toISOString(), duration_ms: 4000, sentence_id: null },
      });
      await postWrite([...known.flatMap((l) => [row(l, 4, 60), row(l, 3, 20)]), ...growing.map((l) => row(l, 3, 2))]);
    },
    { known, growing },
  );
}

test("the field guide: pressed flowers for known words, sketches for growing ones, a page for each", async ({ page }) => {
  await startCourse(page);
  // perro is a rare flower (twin heads, #208), the same for everyone.
  await history(page, ["perro", "casa"], ["mañana"]);
  await page.reload();
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("radio", { name: "Flowers" }).click();

  await expect(page.getByRole("heading", { name: "In bloom" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Still growing" })).toBeVisible();
  const bloom = page.locator(".guide-entry.pressed");
  await expect(bloom).toHaveCount(2);
  await expect(bloom.filter({ hasText: "perro" })).toContainText("Rare: twin heads");
  const growing = page.locator(".guide-entry.sketch");
  await expect(growing).toHaveCount(1);
  await expect(growing.filter({ hasText: "mañana" })).not.toContainText("Rare");

  // A page for the word, with its details; Escape closes it.
  await bloom.filter({ hasText: "perro" }).click();
  const sheet = page.getByRole("dialog", { name: "perro" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Tengo un perro.")).toBeVisible();
  await page.keyboard.press("Escape");
  // A known word's page also has its botanical name (#212).
  await bloom.filter({ hasText: "casa" }).click();
  await expect(page.getByRole("dialog", { name: "casa" }).locator(".guide-latin")).toHaveText("Casa domestica");
  await page.keyboard.press("Escape");
  await bloom.filter({ hasText: "perro" }).click();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  // A tap inside the page, even on its edge, keeps it open; a tap outside closes it.
  await bloom.filter({ hasText: "perro" }).click();
  const box = (await sheet.boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + box.height / 2);
  await expect(sheet).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(sheet).toHaveCount(0);

  // A word open in the list does not pop up when switching to the flowers.
  await page.getByRole("radio", { name: "List" }).click();
  await page.getByRole("button", { name: /casa/ }).click();
  await page.getByRole("radio", { name: "Flowers" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // Only started words are drawn, and the count says so: "New" has nothing to draw.
  await page.locator(".row select").first().selectOption("new");
  await expect(page.getByText("Words you have not started yet have no flower to show.")).toBeVisible();
  await expect(page.getByText("0 words")).toBeVisible();
  await page.locator(".row select").first().selectOption("all");

  // The view is remembered on this device.
  await page.reload();
  await page.getByRole("tab", { name: "Words" }).click();
  await expect(page.getByRole("radio", { name: "Flowers" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("heading", { name: "In bloom" })).toBeVisible();
});

test("a known word's page can be shared as a picture (#225)", async ({ page }) => {
  await startCourse(page);
  await history(page, ["perro"], []);
  await page.reload();
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("radio", { name: "Flowers" }).click();
  await page.locator(".guide-entry.pressed", { hasText: "perro" }).click();
  // No file sharing in this browser: the picture is saved instead.
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Share a picture of this page" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("perennial-perro.png");
  const path = await file.path();
  const { readFileSync } = await import("node:fs");
  const png = readFileSync(path);
  // A PNG, 1080 × 1350 (width and height are at bytes 16–23).
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1350]);
  await file.saveAs("/private/tmp/claude-501/-Users-jussi-projects-ankee/53cda574-db3d-4bad-bffc-f3f1c692bc7d/scratchpad/shared-page.png");
  await expect(page.getByRole("button", { name: "Picture saved. Share it from your files." })).toBeVisible();
});
