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
  await page.getByRole("radio", { name: "Field guide" }).click();

  const bloom = page.locator("section", { has: page.getByRole("heading", { name: "In bloom" }) });
  const growing = page.locator("section", { has: page.getByRole("heading", { name: "Still growing" }) });
  await expect(bloom.locator(".guide-entry.pressed")).toHaveCount(2);
  await expect(bloom.getByRole("button", { name: /perro/ })).toContainText("Rare: twin heads");
  await expect(growing.locator(".guide-entry.sketch")).toHaveCount(1);
  await expect(growing.getByRole("button", { name: /mañana/ })).not.toContainText("Rare");

  // A page for the word, with its details; Escape closes it.
  await bloom.getByRole("button", { name: /perro/ }).click();
  const sheet = page.getByRole("dialog", { name: "perro" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("Tengo un perro.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  // The view is remembered on this device.
  await page.reload();
  await page.getByRole("tab", { name: "Words" }).click();
  await expect(page.getByRole("radio", { name: "Field guide" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("heading", { name: "In bloom" })).toBeVisible();
});
