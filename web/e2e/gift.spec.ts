import { expect, test, type Page } from "@playwright/test";
import { answer, expectServerRows, kicker, startCourse, startSession } from "./helpers";

// #213: a friend's seed. The link holds only a deck word; the friend's course takes it as the next new word.

/** A deck word that is not among the first new words, so planting it first is visible. */
async function farWord(page: Page, lang: "es" | "de") {
  return page.evaluate(async (lang) => {
    const { loadDeck } = await import(/* @vite-ignore */ "/src/data/deck.ts");
    const { courseOrder } = await import(/* @vite-ignore */ "/src/content/order.ts");
    const w = courseOrder(await loadDeck(lang))[200];
    return { id: w.id as string, lemma: w.lemma as string };
  }, lang);
}

test("a new visitor with a seed link: the landing page says so, and the seed is the first plant", async ({ page }) => {
  await page.goto("/");
  const seed = await farWord(page, "de");
  await page.goto(`/?seed=${seed.id}`);
  await expect(page).not.toHaveURL(/seed=/); // taken out of the address
  // The seed's language is chosen, and the card says what happens.
  await expect(page.getByRole("radio", { name: /German/ })).toBeChecked();
  await expect(page.getByRole("note")).toContainText(`A friend gave you a seed: ${seed.lemma}`);
  await expect(page.getByRole("note")).toContainText("It will be your first plant.");
  await page.getByRole("button", { name: "Start learning German" }).click();
  await expect(page.getByRole("status")).toContainText(`Your friend's seed comes next: ${seed.lemma}`);
  await startSession(page);
  await expect(kicker(page)).toHaveText(/new word/);
  await expect(page.locator(".word")).toContainText(seed.lemma);
});

test("a learner with that course already: the seed comes next; with another course only: a card offers to start it", async ({ page }) => {
  await startCourse(page); // Spanish
  const es = await farWord(page, "es");
  await page.goto(`/?seed=${es.id}`);
  await expect(page.getByRole("status")).toContainText(`Your friend's seed comes next: ${es.lemma}`);
  await startSession(page);
  await expect(page.locator(".word")).toContainText(es.lemma);
  await answer(page, "2"); // I knew it: now it grows
  await expectServerRows(page, "review", 1); // saved before the page is left
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: /^Done/ }).click();

  // The same seed again: already growing.
  await page.goto(`/?seed=${es.id}`);
  await expect(page.getByRole("status")).toContainText(`You already grow ${es.lemma}.`);

  // A German seed, with no German course: a card, and "Not now" leaves everything as it was.
  const de = await farWord(page, "de");
  await page.goto(`/?seed=${de.id}`);
  await expect(page.getByRole("note")).toContainText(`A friend gave you a German seed: ${de.lemma}`);
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByRole("note")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("A friend gave you")).toHaveCount(0);
});

test("the whole loop: a known word's page gives a seed link, and a friend's first plant is that word", async ({ browser }) => {
  const me = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await me.newPage();
  await startCourse(page);
  // A known word: reviewed twice, long ago.
  const lemma = await page.evaluate(async () => {
    const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
    const { loadDeck } = await import(/* @vite-ignore */ "/src/data/deck.ts");
    const w = (await loadDeck("es")).words.find((x: { lemma: string }) => x.lemma === "perro")!;
    const row = (grade: number, days: number) => ({ type: "review.insert", row: { id: crypto.randomUUID(), lang: "es", word_id: w.id, skill: "read", grade, kind: grade === 4 ? "known" : "review", reviewed_at: new Date(Date.now() - days * 86_400_000).toISOString(), duration_ms: 4000, sentence_id: null } });
    await postWrite([row(4, 60), row(3, 20)]);
    return w.lemma as string;
  });
  await page.reload();
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("radio", { name: "Flowers" }).click();
  await page.locator(".guide-entry.pressed", { hasText: lemma }).click();
  // Headless Chromium has no share sheet here, so the link is copied.
  await page.evaluate(() => Object.defineProperty(navigator, "share", { value: undefined }));
  await page.getByRole("button", { name: "Give this seed to a friend" }).click();
  await expect(page.getByRole("button", { name: "Link copied. Send it to a friend." })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(`I grew “${lemma}” in Perennial.`);
  const link = copied.match(/https?:\/\/\S+/)![0];
  expect(link).toMatch(/\?seed=es\.w\./);

  // A friend, in another browser, with no account.
  const friend = await (await browser.newContext()).newPage();
  await friend.goto(link);
  await expect(friend.getByRole("note")).toContainText(`A friend gave you a seed: ${lemma}`);
  await friend.getByRole("button", { name: "Start learning Spanish" }).click();
  await startSession(friend);
  await expect(friend.locator(".word")).toContainText(lemma);
});
