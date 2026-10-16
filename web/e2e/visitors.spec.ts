import { expect, test } from "./test";
import { answer, kicker, reveal, startCourse, startSession } from "./helpers";

// #209: learn a garden word, and its visitor comes. The cat is the course's 3rd word,
// so a new learner meets it in the first 5 minutes; the summary says it came.

test("a new learner learns 'gato' in the first session, and the cat comes to the garden", async ({ page }) => {
  await startCourse(page);
  // A new garden has no cat yet (once the strip is drawn, so this is not true by default).
  await expect(page.locator(".garden")).toBeVisible();
  await expect(page.getByRole("button", { name: "el gato · cat" })).toHaveCount(0);
  await startSession(page);
  let sawGato = false;
  // Four new words ("New to me"), gato among them; then their quick checks.
  for (let i = 0; i < 4; i++) {
    await expect(kicker(page)).toHaveText(/new word/);
    if ((await page.locator(".word").textContent())?.includes("gato")) sawGato = true;
    await answer(page, "1");
  }
  expect(sawGato).toBe(true);
  for (let i = 0; i < 4; i++) {
    await expect(kicker(page)).toHaveText(/quick check/);
    const isGato = (await page.locator("main.card").getAttribute("data-lemma")) === "gato";
    const serial = await page.locator(".session").getAttribute("data-card");
    await reveal(page);
    await page.keyboard.press("2"); // I remembered
    if (isGato) {
      // No line over the next card while it comes; the summary says it (#209).
      await expect(page.locator(".session")).not.toHaveAttribute("data-card", serial!);
      // Counted once, not awaited: a line that fades after 4 s would pass a waiting check.
      expect(await page.getByRole("status").count()).toBe(0);
      break;
    }
  }
  await page.getByRole("button", { name: "End session" }).click();
  await expect(page.getByText("A cat came to the garden.")).toBeVisible();
  await page.getByRole("button", { name: /^Done/ }).click();
  // Back on Today, the cat is in the garden strip, at gato's plant (#235).
  const gato = await page.evaluate(async () => {
    const { loadDeck } = await import(/* @vite-ignore */ "/src/data/deck.ts");
    return (await loadDeck("es")).words.find((w: { lemma: string }) => w.lemma === "gato")!.id as string;
  });
  await expect(page.getByRole("button", { name: "el gato · cat" })).toHaveAttribute("data-at", gato);
});

test("a wrong first answer does not bring the cat; the first good one does", async ({ page }) => {
  await startCourse(page);
  await startSession(page);
  for (let i = 0; i < 4; i++) await answer(page, "1"); // four new words, gato among them
  // Quick checks: forget gato, remember the others; then gato's retry comes back.
  for (let i = 0; i < 12; i++) {
    const k = (await kicker(page).textContent()) ?? "";
    const isGato = (await page.locator("main.card").getAttribute("data-lemma")) === "gato";
    await reveal(page);
    if (isGato && !k.includes("try again")) {
      await page.keyboard.press("1"); // I forgot: no cat
      continue;
    }
    await page.keyboard.press("2");
    if (isGato) {
      await page.getByRole("button", { name: "End session" }).click();
      await expect(page.getByText("A cat came to the garden.")).toBeVisible();
      return;
    }
  }
  throw new Error("gato's retry never came");
});

test("a learner who knows perro, pez and mariposa: the dog, the fish and the butterfly are at their plants", async ({ page }) => {
  await startCourse(page);
  // "I knew it" on each, days ago: a good reading answer brings the visitor.
  const ids = await page.evaluate(async () => {
    const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
    const { loadDeck } = await import(/* @vite-ignore */ "/src/data/deck.ts");
    const words: { id: string; lemma: string }[] = (await loadDeck("es")).words;
    const ids: Record<string, string> = {};
    for (const lemma of ["perro", "pez", "mariposa"]) ids[lemma] = words.find((w) => w.lemma === lemma)!.id;
    const at = new Date(Date.now() - 12 * 86_400_000).toISOString();
    await postWrite(Object.values(ids).map((word_id) => ({ type: "review.insert", row: { id: crypto.randomUUID(), lang: "es", word_id, skill: "read", grade: 4, kind: "known", reviewed_at: at, duration_ms: 4000, sentence_id: null } })));
    return ids;
  });
  await expect(page.getByRole("button", { name: "el perro · dog" })).toHaveAttribute("data-at", ids.perro);
  await expect(page.getByRole("button", { name: "el pez · fish" })).toHaveAttribute("data-at", ids.pez);
  await expect(page.getByRole("button", { name: "la mariposa · butterfly" })).toHaveAttribute("data-at", ids.mariposa);
});
