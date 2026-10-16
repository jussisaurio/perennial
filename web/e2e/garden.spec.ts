import { expect, test } from "./test";
import { aimAtGround, arrives, plantNearMiddle, settledGardenWidth, startCourse, walker } from "./helpers";

test("walk-in garden: every word is a plant; next plant, listen, time of day, and back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Pin low quality. CI draws WebGL in software: at normal quality every frame is
  // slow, and each click waits for frames (about 2.5 s a click), so the test ran into
  // its timeout.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
  await page.goto("/?demo=es:30#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page).toHaveURL(/#\/garden$/);
  await expect(page.getByText(/30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20000 });

  await page.getByRole("button", { name: "Next plant" }).click();
  const card = page.getByRole("dialog", { name: /^The plant for / });
  await expect(card).toBeVisible();
  await expect(card).toBeFocused(); // its button went away: focus goes to the card, so a screen reader reads it (#266)
  const first = await card.getAttribute("aria-label");
  await expect(card.getByRole("button", { name: /Listen/ })).toBeVisible();
  await card.getByRole("button", { name: "Next plant" }).click();
  await expect(card).not.toHaveAttribute("aria-label", first!);
  await page.getByRole("button", { name: "Previous plant" }).click();
  await expect(card).toHaveAttribute("aria-label", first!);

  const time = page.getByRole("button", { name: /^Time of day: / });
  const before = await time.textContent();
  const width = (await time.boundingBox())!.width;
  await time.click();
  await expect(time).not.toHaveText(before!);
  // A steady width, so the buttons beside it do not shift (#274).
  expect((await time.boundingBox())!.width).toBe(width);

  // Trackpad swipes look around instead of scrolling.
  await page.mouse.move(400, 300);
  await page.mouse.wheel(-200, 50);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // Escape closes the card first.
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  // Quality toggles and is remembered (last: normal quality is slow to draw here).
  await page.getByRole("button", { name: "Quality: Low quality" }).click();
  await expect(page.getByRole("button", { name: "Quality: Normal quality" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("garden-quality"))).toBe("normal");
  // A second Escape leaves the garden.
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

test("a visitor in the 2D strip shows the app's focus ring when reached with Tab, in light and dark", async ({ page }) => {
  await page.goto("/?demo=es:30&visitors=all#/today");
  const snail = page.getByRole("button", { name: "el caracol · snail" });
  await expect(snail).toBeAttached({ timeout: 30_000 });
  // The persimmon ring every other control has (index.css :focus-visible).
  for (const [scheme, persimmon] of [["light", "rgb(220, 86, 54)"], ["dark", "rgb(255, 123, 88)"]] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    // Tab, as a keyboard user does, so the browser applies :focus-visible.
    for (let i = 0; i < 60 && !(await snail.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(snail).toBeFocused();
    const ring = await snail.evaluate((el) => {
      const s = getComputedStyle(el);
      return { style: s.outlineStyle, color: s.outlineColor };
    });
    expect(ring).toEqual({ style: "solid", color: persimmon });
  }
});

test("visitors in the walk: the frog's tag at dusk, a tap croaks a known word, and by day it sleeps", async ({ page }) => {
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
    const s = (window as unknown as { __garden: { guests: { sprites: Sprite[] }; layout: { pond: { x: number; z: number } }; x: number; z: number; yaw: number; pitch: number } }).__garden;
    const frog = s.guests.sprites.find((o) => o.v.id === "frog")!;
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
  // By day it stays, asleep on its pad, as in the strip: a learner who brought it finds it (#209).
  await time.click();
  await time.click();
  await expect(time).toHaveAttribute("aria-label", "Time of day: Day");
  await expect(tag).toHaveText("la rana · frog");
  expect(await page.evaluate(() => (window as unknown as { __garden: { frogAwake(): boolean } }).__garden.frogAwake())).toBe(false);
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
  await settledGardenWidth(page);
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
  await settledGardenWidth(page);
  const max = await strip.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(await scrollLeft()).toBeGreaterThan(max - 2); // opens on the newest growth
  // Only plants in view are drawn, however big the garden.
  expect(await page.locator(".garden svg > g").count()).toBeLessThan(120);

  // At the end, "later" is disabled. It pages back, then "later" appears.
  await expect(page.getByRole("button", { name: "Later words" })).toBeDisabled();
  await page.getByRole("button", { name: "Earlier words" }).click();
  await expect.poll(scrollLeft).toBeLessThan(max - 300);
  await expect(page.getByRole("button", { name: "Later words" })).toBeEnabled();

  // A click on a plant opens its card; its link opens the plant in 3D.
  await page.mouse.click(...(await plantNearMiddle(page)));
  const card = page.locator(".plant-tip");
  await expect(card).toBeVisible();
  const word = (await card.locator("strong").textContent())!;
  await card.getByRole("button", { name: /View in garden/ }).click();
  await expect(page.getByRole("dialog", { name: `The plant for ${word}` })).toBeVisible({ timeout: 20_000 });
});

test("the garden itself teaches: tap the sunflower for its word; a plant still opens its card (#74)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // A fixed day and hour: the snail walks the fence over the day (snailLap) and, from
  // about 09:19 to 09:35, stands between us and the sunflower; visitors change by day.
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
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

// #158: a two-finger touchpad swipe looks around in the walk; it must not also be the
// browser's swipe-back gesture. Browsers decide that at the page root.
test("the walk switches off swipe-back navigation while it is open, and only then", async ({ page }) => {
  const rootOverscroll = () => page.evaluate(() => [getComputedStyle(document.documentElement).overscrollBehaviorX, getComputedStyle(document.body).overscrollBehaviorX]);
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
  await page.goto("/?demo=es:30#/today");
  expect(await rootOverscroll()).toEqual(["auto", "auto"]);
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.locator(".gw")).toBeVisible();
  expect(await rootOverscroll()).toEqual(["none", "none"]);
  // Safari ignores that: there only a handled wheel stops it, over the canvas and the panels alike.
  await page.evaluate(() => {
    (window as unknown as { prevented: boolean[] }).prevented = [];
    document.addEventListener("wheel", (e) => (window as unknown as { prevented: boolean[] }).prevented.push(e.defaultPrevented));
  });
  for (const target of [page.locator(".gw canvas"), page.locator(".gw-top")]) {
    const box = (await target.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(-200, 0);
  }
  await expect.poll(() => page.evaluate(() => (window as unknown as { prevented: boolean[] }).prevented)).toEqual([true, true]);
  await page.getByRole("button", { name: "Back" }).click();
  await expect(page.locator(".gw")).toHaveCount(0);
  expect(await rootOverscroll()).toEqual(["auto", "auto"]);
});

// Tap to walk (#336) with a mouse: a click on the ground walks there. The view
// turns gently toward where you walk, unless the viewer asked for reduced motion.
for (const reducedMotion of ["no-preference", "reduce"] as const)
  test.describe(`motion: ${reducedMotion}`, () => {
    test.use({ reducedMotion });
    test(`a click on the ground walks there; the view ${reducedMotion === "reduce" ? "keeps still" : "turns toward it"} (#336)`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
      await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
      await page.goto("/?demo=es:30#/today");
      await page.getByRole("button", { name: "Walk in your garden" }).click();
      await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
      await page.waitForFunction(() => "__garden" in window);
      // Facing a little left of the spot.
      const { x, y, to, kind, yaw } = await aimAtGround(page, 0.4);
      expect(kind).toBe("walk");
      await page.mouse.click(x, y);
      await arrives(page, to);
      const turned = yaw - (await walker(page)).yaw;
      if (reducedMotion === "reduce") expect(turned).toBe(0);
      else expect(turned).toBeGreaterThan(0.2);
      expect(errors).toEqual([]);
    });
  });

test("a walking key takes over from a walk under way (#336)", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
  await page.goto("/?demo=es:30#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  const { x, y, to } = await aimAtGround(page, 0);
  const start = await walker(page);
  await page.mouse.click(x, y);
  expect((await walker(page)).walking).toBe(true);
  // S steps back: the walk stops, and you end up farther from where it went.
  await page.keyboard.down("KeyS");
  await page.waitForTimeout(500);
  await page.keyboard.up("KeyS");
  const after = await walker(page);
  expect(after.walking).toBe(false);
  expect(Math.hypot(after.x - to.x, after.z - to.z)).toBeGreaterThan(Math.hypot(start.x - to.x, start.z - to.z));
});

// #334: one action button for what is in reach; its icon changes shape, and a screen reader hears what it does.
test("by the bench the action button sits you down, facing the pond; it or a step stands you up again", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
  await page.goto("/?demo=es:30#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  type Bench = { x: number; z: number; seated: boolean; camera: { position: { y: number } }; layout: { pond: { x: number; z: number; r: number } } };
  const scene = () =>
    page.evaluate(() => {
      const s = (window as unknown as { __garden: Bench }).__garden;
      return { seated: s.seated, eye: s.camera.position.y };
    });
  await expect(page.getByRole("button", { name: "Sit on the bench" })).toHaveCount(0);
  // A step in front of the bench (world.ts benchAt), facing it.
  await page.evaluate(() => {
    const s = (window as unknown as { __garden: Bench }).__garden;
    const p = s.layout.pond;
    Object.assign(s, { x: p.x + 0.2, z: p.z - p.r - 1.6, yaw: 0, pitch: 0 });
  });
  const sit = page.getByRole("button", { name: "Sit on the bench" });
  await expect(sit).toHaveText("");
  const standing = (await scene()).eye;
  await sit.click();
  await expect(page.getByRole("button", { name: "Stand up" })).toBeVisible();
  // Reduced motion (as these tests run): the eye sinks at once.
  await expect.poll(async () => (await scene()).eye).toBeLessThan(standing - 0.2);
  await page.getByRole("button", { name: "Stand up" }).click();
  await expect(sit).toBeVisible();
  await expect.poll(async () => (await scene()).eye).toBeCloseTo(standing, 1);
  // Any step stands you up too.
  await sit.click();
  await expect(page.getByRole("button", { name: "Stand up" })).toBeVisible();
  await page.keyboard.down("KeyS");
  await page.waitForTimeout(150);
  await page.keyboard.up("KeyS");
  expect((await scene()).seated).toBe(false);
});

test("the controls hint shows on the first walk only (#334)", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
  await page.goto("/?demo=es:30#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".gw-hint")).toContainText("Walk:");
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  await expect(page.locator(".gw-hint")).toHaveCount(0);
});
