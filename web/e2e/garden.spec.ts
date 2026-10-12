import { expect, test } from "@playwright/test";
import { startCourse } from "./helpers";

test("walk-in garden: every word is a plant; next plant, listen, time of day, and back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Pin the quality: software rendering here is slow and would switch to low by itself.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "normal"));
  await page.goto("/?demo=es:30#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page).toHaveURL(/#\/garden$/);
  await expect(page.getByText(/30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20000 });

  await page.getByRole("button", { name: "Next plant →" }).click();
  const card = page.getByRole("dialog", { name: /^The plant for / });
  await expect(card).toBeVisible();
  const first = await card.getAttribute("aria-label");
  await expect(card.getByRole("button", { name: /Listen/ })).toBeVisible();
  await card.getByRole("button", { name: "Next plant →" }).click();
  await expect(card).not.toHaveAttribute("aria-label", first!);
  await page.getByRole("button", { name: "Previous plant" }).click();
  await expect(card).toHaveAttribute("aria-label", first!);

  const time = page.getByRole("button", { name: /^Time of day: / });
  const before = await time.textContent();
  await time.click();
  await expect(time).not.toHaveText(before!);

  // Quality toggles and is remembered; trackpad swipes look around instead of scrolling.
  await page.getByRole("button", { name: "Quality: Normal quality" }).click();
  await expect(page.getByRole("button", { name: "Quality: Low quality" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("garden-quality"))).toBe("low");
  await page.mouse.move(400, 300);
  await page.mouse.wheel(-200, 50);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // Escape closes the card first, then leaves the garden.
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/today$/);
  expect(errors).toEqual([]);
});

test("visitors: the snail and the cat in the 2D strip say their word; they are not plants", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => localStorage.setItem("garden-quality", "normal"));
  // A dev-only override brings every visitor today, so the test does not depend on the date.
  await page.goto("/?demo=es:30&visitors=all#/today");
  const snail = page.getByRole("button", { name: "el caracol · snail" });
  await expect(snail).toBeAttached({ timeout: 30_000 });
  await snail.evaluate((el) => el.scrollIntoView({ inline: "center", block: "center" }));
  await snail.hover();
  await expect(page.getByRole("tooltip")).toHaveText("el caracol · snail");
  // The cat sleeps at the right end of the strip.
  const cat = page.getByRole("button", { name: "el gato · cat" });
  await cat.evaluate((el) => el.scrollIntoView({ inline: "center", block: "center" }));
  await cat.click();
  await expect(page.getByRole("tooltip")).toHaveText("el gato · cat");

  // Visitors are not plants: the walk still counts only the learner's words.
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  expect(errors).toEqual([]);
});

test("visitors in the walk: the frog's tag at dusk, and a tap croaks a known word", async ({ page }) => {
  // Midday, so the walk opens by day and the switch to evening happens while it may
  // still be loading (a time chosen during loading used to be lost: no frog by dusk).
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => localStorage.setItem("garden-quality", "normal"));
  // The dev override brings every visitor; the dev-only scene handle lets the test stand by the pond.
  await page.goto("/?demo=es:30&visitors=all#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  const time = page.getByRole("button", { name: /^Time of day: / });
  while ((await time.getAttribute("aria-label")) !== "Time of day: Evening") await time.click();
  await page.waitForFunction(() => "__garden" in window);
  await page.evaluate(() => {
    type Sprite = { v: { id: string }; x: number; z: number };
    const s = (window as unknown as { __garden: { visitorSprites: Sprite[]; layout: { pond: { x: number; z: number } }; x: number; z: number; yaw: number; pitch: number } }).__garden;
    const frog = s.visitorSprites.find((o) => o.v.id === "frog")!;
    // 1.3 m from the frog, on the side away from the middle of the pond, looking at it.
    const a = Math.atan2(frog.x - s.layout.pond.x, frog.z - s.layout.pond.z);
    s.x = frog.x + Math.sin(a) * 1.3;
    s.z = frog.z + Math.cos(a) * 1.3;
    s.yaw = a;
    s.pitch = -0.45;
  });
  const tag = page.locator(".gw-tag", { hasText: "la rana" });
  await expect(tag).toHaveText("la rana · frog");
  const box = (await tag.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 25);
  // Its sound and a word (the demo learner's words); never its own name.
  await expect(page.locator(".gw-say")).toHaveText(/^croac…/);
  await expect(page.locator(".gw-say")).not.toHaveText(/rana/);
  // By day the frog is gone, and so is its tag.
  await time.click();
  await time.click();
  await expect(time).toHaveAttribute("aria-label", "Time of day: Day");
  await expect(page.locator(".gw-tag", { hasText: "la rana" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the garden tab opens the garden; an empty garden offers the first session", async ({ page }) => {
  await startCourse(page);
  // The empty strip is not empty: a stake, and a worm that says its word (#58).
  await expect(page.locator(".garden-stake")).toHaveText("Reserved for Spanish wordsReservado");
  await page.getByRole("button", { name: "el gusano · worm" }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("el gusano · wormWaiting.");
  await page.getByRole("tab", { name: "Garden" }).click();
  await expect(page.getByText("Just soil for now. Very good soil.")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Plant my first words" })).toBeVisible();
});

test("the ends of the strip: the first word's post at the left, the mole at the right (#61)", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  // The dev override brings the mole today, whatever the date.
  await page.goto("/?demo=es&visitors=all#/today");
  const strip = page.locator(".garden-scroll");
  await expect(page.locator(".garden.scrolls")).toBeVisible({ timeout: 30_000 });
  const width = () => strip.evaluate((el) => el.scrollWidth);
  await expect.poll(async () => {
    const a = await width();
    await page.waitForTimeout(500);
    return a === (await width()) && a > 2000;
  }, { timeout: 30_000 }).toBe(true);
  // The strip opens at the right end, where the mole looks up and says its word.
  const mole = page.getByRole("button", { name: "el topo · mole" });
  await expect(page.locator(".mole.up")).toHaveCount(1);
  await mole.hover();
  await expect(page.getByRole("tooltip")).toHaveText("el topo · mole");
  // At the far left: the first word and the day it was planted. The mole has gone down.
  await strip.evaluate((el) => (el.scrollLeft = 0));
  await expect(page.locator(".keepsake text")).toHaveText(/^\S+ · \d{1,2} [A-Z][a-z]{2}$/);
  await expect(page.locator(".mole.up")).toHaveCount(0);
});

test("2D garden: a big garden scrolls; arrows page through it; a plant opens in the 3D garden", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto("/?demo=es#/today");
  const strip = page.locator(".garden-scroll");
  await expect(page.locator(".garden.scrolls")).toBeVisible({ timeout: 30_000 });
  const scrollLeft = () => strip.evaluate((el) => el.scrollLeft);
  // The demo learner's words sync in over a moment: wait until the garden stops growing.
  const width = () => strip.evaluate((el) => el.scrollWidth);
  await expect.poll(async () => {
    const a = await width();
    await page.waitForTimeout(500);
    return a === (await width()) && a > 2000;
  }, { timeout: 30_000 }).toBe(true);
  const max = await strip.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(await scrollLeft()).toBeGreaterThan(max - 2); // opens on the newest growth
  // Only plants in view are drawn, however big the garden.
  expect(await page.locator(".garden svg > g").count()).toBeLessThan(120);

  // At the end, "later" is disabled. It pages back, then "later" appears.
  await expect(page.getByRole("button", { name: "Later words" })).toBeDisabled();
  await page.getByRole("button", { name: "Earlier words" }).click();
  await expect.poll(scrollLeft).toBeLessThan(max - 300);
  await expect(page.getByRole("button", { name: "Later words" })).toBeEnabled();

  // A click opens the card; its link opens the plant in 3D.
  // The plant nearest the middle (between two plants there is a small gap).
  const box = (await strip.boundingBox())!;
  const [px, py] = await page.locator(".garden svg > g[transform] rect").evaluateAll((els, mid) => {
    const r = els.map((e) => e.getBoundingClientRect()).sort((a, b) => Math.abs(a.x + a.width / 2 - mid) - Math.abs(b.x + b.width / 2 - mid))[0];
    return [r.x + r.width / 2, r.bottom - 20];
  }, box.x + box.width / 2);
  await page.mouse.click(px, py);
  const card = page.locator(".plant-tip");
  await expect(card).toBeVisible();
  const word = (await card.locator("strong").textContent())!;
  await card.getByRole("button", { name: /View in garden/ }).click();
  await expect(page.getByRole("dialog", { name: `The plant for ${word}` })).toBeVisible({ timeout: 20_000 });
});

test("the garden itself teaches: tap the sunflower for its word; a plant still opens its card (#74)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => localStorage.setItem("garden-quality", "normal"));
  await page.goto("/?demo=es:30#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  // Stand somewhere, and return where a point shows on the canvas, in page pixels. The dev-only scene handle makes it exact.
  const standAndAim = (at: { x: number; z: number; yaw: number; pitch: number }, target: "flower" | "plant") =>
    page.evaluate(
      ([at, target]) => {
        type V = { project(c: unknown): { x: number; y: number } };
        type Scene = { flower: { x: number; z: number }; layout: { plants: { x: number; z: number }[] }; camera: unknown; tmp: { constructor: new (x: number, y: number, z: number) => V } };
        const s = (window as unknown as { __garden: Scene }).__garden;
        const p = target === "flower" ? s.flower : s.layout.plants[0];
        Object.assign(s, { x: p.x + at.x, z: p.z + at.z, yaw: at.yaw, pitch: at.pitch });
        return new Promise<[number, number]>((done) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const v = new s.tmp.constructor(p.x, target === "flower" ? 0.9 : 0.5, p.z).project(s.camera);
              const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
              done([r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]);
            }),
          ),
        );
      },
      [at, target] as const,
    );
  // On the back path, 2.5 m to the sunflower's left, looking at it along the fence.
  const [fx, fy] = await standAndAim({ x: -2.5, z: 0, yaw: -Math.PI / 2, pitch: 0 }, "flower");
  // No tag on approach: scenery shows its word only when tapped.
  await expect(page.locator(".gw-tag")).toHaveCount(0);
  await page.mouse.click(fx, fy);
  await expect(page.locator(".gw-tag")).toHaveText("el girasol · sunflower");
  // A drag to look around is not a tap: no card opens.
  await page.mouse.move(fx, fy + 60);
  await page.mouse.down();
  await page.mouse.move(fx + 80, fy + 60, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole("dialog", { name: /^The plant for / })).toHaveCount(0);

  // A plant comes first: a tap on it opens its card, and the scenery tag goes.
  const [px, py] = await standAndAim({ x: 0, z: 1.4, yaw: 0, pitch: -0.3 }, "plant");
  await page.mouse.click(px, py);
  await expect(page.getByRole("dialog", { name: /^The plant for / })).toBeVisible();
  await expect(page.locator(".gw-tag")).toHaveCount(0);
  expect(errors).toEqual([]);
});
