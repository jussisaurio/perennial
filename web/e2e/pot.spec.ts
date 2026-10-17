import { expect, test, type Page } from "./test";
import { serverRows, waitForSynced } from "./helpers";

// #387, two seeds, one pot: take a seed from the cat's plant and one from the
// bird's, put both in the clay pot by the shed; the next day a cat with wings
// has hatched in it. Let it out, and it wanders the garden. Days are calendar days.

type Pot = { sown: number; out: number; seeds: string[]; day: number | null; hatched: { base: string; trait: string }[] };
type PotScene = {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  layout: { plants: { garden?: string; x: number; z: number }[] };
  pots: { pot: Pot; now: { kind: string; creature?: { base: string; trait: string } } };
};

// Months before today: the server refuses days in its future, and the clock here is pinned.
const DAY = new Date("2026-06-01T12:00:00");

async function openWalk(page: Page) {
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
}

const potNow = (page: Page) => page.evaluate(() => (window as unknown as { __garden: PotScene }).__garden.pots.now);
const savedPot = async (page: Page) => (await serverRows<{ lang: string; garden_pot: Pot }>(page, "course")).find((r) => r.lang === "es")?.garden_pot;
const act = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const status = (page: Page) => page.locator(".gw > [role=status]");

/** Stand a little in front of the plant of a garden word, facing it. */
const byPlant = (page: Page, word: string) =>
  page.evaluate((word) => {
    const s = (window as unknown as { __garden: PotScene }).__garden;
    const p = s.layout.plants.find((q) => q.garden === word)!;
    // Forward is -z at yaw 0.
    Object.assign(s, { x: p.x, z: p.z + 1.2, yaw: 0, pitch: -0.3 });
  }, word);

/** Stand beside the pot, facing it. */
const byPot = (page: Page) =>
  page.evaluate(async () => {
    const { potAt } = await import(/* @vite-ignore */ "/src/garden/pot.ts");
    const s = (window as unknown as { __garden: PotScene & { layout: Parameters<typeof potAt>[0] } }).__garden;
    const p = potAt(s.layout);
    // Facing +x, toward the pot and the shed behind it.
    Object.assign(s, { x: p.x - 0.6, z: p.z, yaw: -Math.PI / 2, pitch: -0.4 });
  });

/** Take a seed from a visitor's plant and put it in the pot, with the action button. */
async function sowFrom(page: Page, word: string, name: string) {
  await byPlant(page, word);
  await act(page, "Take a seed").click();
  await expect(status(page)).toHaveText(`You hold a seed of ${name}.`);
  await expect(page.locator(".gw-hand")).toBeVisible();
  await byPot(page);
  await act(page, "Put the seed in the pot").click();
  await expect(page.locator(".gw-hand")).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(DAY);
  await page.setViewportSize({ width: 1280, height: 800 });
  // Low quality: software WebGL on CI draws it faster, and every click waits for frames.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
});

test("take a seed from the cat's plant and the bird's, put them in the pot, and the next day a cat with wings hatches", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?demo=es:30#/today");
  await expect(page.getByRole("button", { name: "Walk in your garden" })).toBeVisible({ timeout: 20_000 });
  // The cat's word and the bird's, learned last week: their plants are in the garden.
  const reviewIds = await page.evaluate(async () => {
    const { postWrite } = await import(/* @vite-ignore */ "/src/data/http.ts");
    const { loadDeck } = await import(/* @vite-ignore */ "/src/data/deck.ts");
    const words = (await loadDeck("es")).words as { id: string; lemma: string }[];
    const review = (lemma: string) => ({
      type: "review.insert",
      row: { id: crypto.randomUUID(), lang: "es", word_id: words.find((w) => w.lemma === lemma)!.id, skill: "read", grade: 4, kind: "known", reviewed_at: new Date(Date.now() - 7 * 86_400_000).toISOString(), duration_ms: 4000, sentence_id: null },
    });
    const rows = [review("gato"), review("pájaro")];
    await postWrite(rows);
    return rows.map((r) => r.row.id);
  });
  await page.goto("/#/today");
  // Wait on the reviews landing in the app's own data (#343), not on time, before the walk takes its snapshot.
  await waitForSynced(page, "review", reviewIds);
  await openWalk(page);
  expect((await potNow(page)).kind).toBe("empty");

  await sowFrom(page, "cat", "el gato");
  expect(await potNow(page)).toEqual({ kind: "seeds", seeds: ["cat"] });
  await sowFrom(page, "bird", "el pájaro");
  // The same day: two seeds, nothing hatched yet, and the pot takes no more: the cat's plant is shaken again.
  expect(await potNow(page)).toEqual({ kind: "seeds", seeds: ["cat", "bird"] });
  await byPlant(page, "cat");
  await expect(act(page, "Shake the plant")).toBeVisible();
  // Saved with the course: ids and a day only.
  await expect.poll(async () => (await savedPot(page))?.seeds, { timeout: 15_000 }).toEqual(["cat", "bird"]);

  // The next morning.
  await page.clock.setFixedTime(new Date(DAY.getTime() + 86_400_000));
  await page.goto("/#/today");
  await page.reload();
  await openWalk(page);
  expect(await potNow(page)).toEqual({ kind: "hatched", creature: { base: "cat", trait: "bird" } });
  await byPot(page);
  await expect(status(page)).toHaveText("A cat with wings hatched in the pot. un gato con alas");
  await act(page, "Let it out of the pot").click();
  // Its name, over it, in the course language.
  await expect(page.locator(".gw-tag").filter({ hasText: "un gato con alas" })).toBeVisible();
  expect((await potNow(page)).kind).toBe("empty");
  await expect.poll(async () => (await savedPot(page))?.hatched, { timeout: 15_000 }).toEqual([{ base: "cat", trait: "bird" }]);
  expect(errors).toEqual([]);
});
