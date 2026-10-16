import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "./test";
import { expectServerRows, serverRows, startCourse } from "./helpers";

test("course words: search the upcoming words, pause and resume, never show (with undo)", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("combobox").selectOption("new"); // what comes next
  const first = page.locator(".word-row").first();
  const lemma = (await first.locator("strong").textContent())!;
  await page.getByPlaceholder("Search words or meanings").fill(lemma);
  const row = page.locator(".word-row", { has: page.locator(`strong:text-is("${lemma}")`) });
  await row.click();

  // Not started yet: says so plainly; course sentences are shown and labelled.
  await expect(page.getByText("Not started.")).toBeVisible();
  await expect(page.locator(".examples .author").first()).toHaveText("From the course");
  await expect(page.getByLabel("Meaning")).toHaveCount(0); // course words are not edited here

  // The two choices say how they differ (#262).
  await expect(page.getByText("Pause: it stays out of sessions until you resume it. Never show: it leaves your course.")).toBeVisible();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Paused. It does not appear in sessions.")).toBeVisible();
  await expectServerRows(page, "word_state", 1);
  await page.getByRole("button", { name: "Resume" }).click();
  await expectServerRows(page, "word_state", 0);

  await page.getByRole("button", { name: "Never show this word" }).click();
  await expect(page.getByText(`“${lemma}” will not come up again.`)).toBeVisible();
  await expect.poll(async () => (await serverRows<{ status: string }>(page, "word_state"))[0]?.status).toBe("ignored");
  await page.getByRole("button", { name: "Undo" }).click();
  await expectServerRows(page, "word_state", 0);
});

test("All and New find any word in the course, also one far past the first 500 (#262)", async ({ page }) => {
  await startCourse(page);
  const late = await page.evaluate(async () => {
    const { loadDeck } = await import(/* @vite-ignore */ "/src/data/deck.ts");
    const { courseOrder } = await import(/* @vite-ignore */ "/src/content/order.ts");
    return courseOrder(await loadDeck("es"))[900].lemma as string;
  });
  await page.getByRole("tab", { name: "Words" }).click();
  const row = page.locator(".word-row", { has: page.locator(`strong:text-is("${late}")`) });
  await page.getByPlaceholder("Search words or meanings").fill(late);
  await expect(row).toBeVisible(); // under All, the default
  await page.getByRole("combobox", { name: "Which words" }).selectOption("new");
  await expect(row).toBeVisible();
  await page.getByRole("combobox", { name: "Which words" }).selectOption("all");
  await page.getByPlaceholder("Search words or meanings").fill("qqzzxx");
  await expect(page.getByText("No word like this in the course.")).toBeVisible();
});

test("empty lists say what is missing, with a small wink (#58)", async ({ page }) => {
  await startCourse(page);
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("combobox").selectOption("suspended");
  await expect(page.getByText("No paused words. Everyone is awake.")).toBeVisible();
  await page.getByRole("combobox").selectOption("known");
  await expect(page.getByText("No flowers yet. They are coming.")).toBeVisible();
  await page.getByRole("combobox").selectOption("new");
  await page.getByPlaceholder("Search words or meanings").fill("qqzzxx");
  await expect(page.getByText("No new word like this. Try All.")).toBeVisible(); // New has every word not started: say where else to look (#262)
});

test("keyboard: Enter starts today's session, / focuses the word search", async ({ page }) => {
  await startCourse(page);
  await page.locator("body").click({ position: { x: 5, y: 5 } }); // nothing focused
  await page.keyboard.press("Enter");
  await expect(page.locator(".kicker")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Words" }).click();
  await page.locator("h1").click();
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox")).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Which words" })).toBeVisible(); // the filter has a name (#266)
  // The count is said once typing pauses, not as the page opens (#266).
  const heard = page.locator(".page p.sr-only[aria-live]");
  await expect(heard).toHaveText("");
  await page.keyboard.type("x");
  await expect(page.getByRole("searchbox")).toHaveValue("x"); // the slash itself isn't typed
  await expect(heard).toHaveText(/^\d+ words? found\.$/);
  // "/" works while a tab button has focus too: "/" never presses a button (#266).
  await page.getByRole("tab", { name: "Words" }).click();
  await expect(page.getByRole("tab", { name: "Words" })).toBeFocused();
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox")).toBeFocused();
});

test("word detail: scheduling details show stability, difficulty, recall and the review log", async ({ page }) => {
  await page.goto("/?demo=es:5#/words");
  // A row names the skills practised, without an unlabelled recall number (#262).
  await expect(page.locator(".word-row .pip").first()).toBeVisible();
  await expect(page.locator(".word-row .skills").first()).not.toContainText("%");
  await page.locator(".word-row").first().click();
  await page.getByText("Scheduling details").click();
  const details = page.locator(".scheduling");
  await expect(details.getByRole("columnheader", { name: "Stability" })).toBeVisible();
  await expect(details.locator("tbody tr").first()).toContainText("%");
  await expect(details.locator(".review-log li").first()).toBeVisible();
});

// Adding words from a text needs Perennial AI: with it off on the server, the feature is hidden.
test("with Perennial AI off, Add words is hidden, and its address shows the word list", async ({ page }) => {
  await page.route("**/api/server", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), features: { ai: false } } });
  });
  await startCourse(page);
  await page.getByRole("tab", { name: "Words" }).click();
  await expect(page.getByRole("heading", { name: "Words" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add words" })).toHaveCount(0);
  await expect(page.locator("option", { hasText: "From my texts" })).toHaveCount(0); // no way to fill it (#262)
  await page.goto("/#/words/add");
  await expect(page.getByRole("heading", { name: "Words" })).toBeVisible();
  await expect(page.getByPlaceholder(/Paste .* text here/)).toHaveCount(0);
});

test("a word saved with its forms as a JSON string (#337) is found by search, known in Add, and can be edited", async ({ page }) => {
  await startCourse(page);
  const userId = await page.evaluate(() => (window as unknown as { __store: { userId: string } }).__store.userId);
  // As /api/write stored forms before #340: a jsonb string holding the list's JSON text.
  // Straight into the dev database (docker-compose.yml), which the e2e server uses.
  const db = new Client("postgres://perennial:perennial@localhost:25432/perennial");
  await db.connect();
  try {
    await db.query("insert into user_word (id, user_id, lang, lemma, gloss, forms) values ($1, $2, 'es', 'xilofonista', 'xylophonist', to_jsonb($3::text))", [
      randomUUID(),
      userId,
      JSON.stringify(["xilofonista", "xilofonistas"]),
    ]);
  } finally {
    await db.end();
  }

  // Search reaches the word's forms when the headword and meaning don't match.
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByPlaceholder("Search words or meanings").fill("fonistas");
  const row = page.locator(".word-row", { has: page.locator('strong:text-is("xilofonista")') });
  await expect(row).toBeVisible();

  // Add knows the plural as the learner's own word, not as a new one.
  await page.getByRole("button", { name: "Add words" }).click();
  await page.getByPlaceholder(/Paste .* text here/).fill("Los xilofonistas tocan.");
  await expect(page.locator(".reader .tok.added", { hasText: /^xilofonistas$/ })).toBeVisible();

  // An edit sends the forms back as a list, so the server takes it.
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByPlaceholder("Search words or meanings").fill("xilofonista");
  await row.click();
  await page.getByLabel("Meaning").fill("xylophone player");
  await page.getByLabel("Meaning").blur();
  await expect.poll(async () => (await serverRows<{ gloss: string }>(page, "user_word"))[0]?.gloss).toBe("xylophone player");
});
