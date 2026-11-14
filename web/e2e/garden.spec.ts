import { expect, test, type Page } from "./test";
import { aimAtGround, arrives, gameSeconds, pinDetail, plantNearMiddle, settledGardenWidth, startCourse, trackOf, trackVisitors, walker } from "./helpers";
import { BENCH, WALKER } from "../src/garden/world";

test("walk-in garden: every word is a plant; next plant by keyboard, listen, and back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Pin low detail. CI draws WebGL in software: at normal detail every frame is
  // slow, and each click waits for frames (about 2.5 s a click), so the test ran into
  // its timeout.
  await pinDetail(page, "low");
  await page.clock.setFixedTime(new Date(2026, 5, 10, 12));
  await page.goto("/?demo=es:30#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page).toHaveURL(/#\/garden$/);
  await expect(page.getByText(/30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20000 });

  // Next plant is for the keyboard only (#710): hidden until Tab reaches it, then shown.
  const next = page.getByRole("button", { name: "Next plant" });
  // Shown means a tap at its middle lands on it.
  const shown = () =>
    next.evaluate((b) => {
      const r = b.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === b;
    });
  expect(await shown()).toBe(false);
  // Back and the sound switch come first.
  await expect(async () => {
    await page.keyboard.press("Tab");
    await expect(next).toBeFocused({ timeout: 100 });
  }).toPass({ timeout: 5000 });
  expect(await shown()).toBe(true);
  await page.keyboard.press("Enter");
  const card = page.getByRole("dialog", { name: /^The plant for / });
  await expect(card).toBeVisible();
  await expect(card).toBeFocused(); // its button went away: focus goes to the card, so a screen reader reads it (#266)
  const first = await card.getAttribute("aria-label");
  await expect(card.getByRole("button", { name: /Listen/ })).toBeVisible();
  // After the card closes, Next plant goes on to the next plant, not the first again.
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await next.focus();
  await page.keyboard.press("Enter");
  await expect(card).toBeVisible();
  await expect(card).not.toHaveAttribute("aria-label", first!);

  // Trackpad swipes look around instead of scrolling.
  await page.mouse.move(400, 300);
  await page.mouse.wheel(-200, 50);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // Escape closes the card first.
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  // A second Escape leaves the garden.
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/#\/today$/);
  expect(errors).toEqual([]);
});

test("visitors: the snail and the cat in the 2D strip say their word; they are not plants", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await pinDetail(page, "normal");
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

test("Today's strip stays one element while the rest of Today comes in, so its entrance plays once (#653)", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.clock.setFixedTime(new Date(2026, 5, 10, 12));
  // Hold animation frames: the rest of Today waits for one (Home's useAfterPaint), so the strip shows first, with no data.
  // Only once the strip is there: the deck loads after a frame too (useDeck), and the strip needs it (#796).
  // Home asks for its frame only after the strip is drawn, so that frame is always held.
  // Not a paused clock: the app's loading waits on timers too.
  await page.addInitScript(() => {
    const held = new Map<number, FrameRequestCallback>();
    const { requestAnimationFrame: request, cancelAnimationFrame: cancel } = window;
    let hold = true;
    let id = 0;
    const holding = () => hold && document.querySelector('[data-testid="today-garden"]') !== null;
    window.requestAnimationFrame = (cb) => (holding() ? (held.set(--id, cb), id) : request(cb));
    window.cancelAnimationFrame = (n) => (n < 0 ? held.delete(n) : cancel(n));
    Object.assign(window, {
      releaseFrames: () => {
        hold = false;
        for (const cb of held.values()) request(cb);
      },
    });
  });
  await page.goto("/?demo=es:30&visitors=all#/today");
  const strip = page.getByTestId("today-garden");
  await expect(strip).toBeAttached({ timeout: 30_000 });
  const before = await strip.elementHandle();
  const snail = page.getByRole("button", { name: "el caracol · snail" });
  await expect(snail).toHaveCount(0);

  await page.evaluate(() => (window as unknown as { releaseFrames: () => void }).releaseFrames());
  await snail.hover();
  await expect(page.getByRole("tooltip")).toHaveText("el caracol · snail");
  // A new element would play the rise again: it moves the snail out from under the pointer, and its word goes.
  expect(await strip.evaluate((el, b) => el === b && el.isConnected, before)).toBe(true);
  await strip.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await expect(page.getByRole("tooltip")).toHaveText("el caracol · snail");
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

test("visit.frog-jokes: tapped on, the frog says its lines, then has no more words", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-11T19:00:00"));
  await pinDetail(page, "normal");
  // 400 known Spanish words: its first line and its last (frogLines.ts).
  await page.goto("/?demo=es:known:400&visitors=frog#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.locator(".gw")).toHaveClass(/\bgw-dusk\b/, { timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  await page.evaluate(() => {
    type Sprite = { v: { id: string }; body: { at: { x: number; z: number } } };
    const s = (window as unknown as { __garden: { guests: { sprites: Sprite[] }; layout: { pond: { x: number; z: number } }; x: number; z: number; yaw: number; pitch: number } }).__garden;
    const frog = s.guests.sprites.find((o) => o.v.id === "frog")!.body.at;
    // 1.3 m from the frog, on the side away from the middle of the pond, looking at it.
    const a = Math.atan2(frog.x - s.layout.pond.x, frog.z - s.layout.pond.z);
    s.x = frog.x + Math.sin(a) * 1.3;
    s.z = frog.z + Math.cos(a) * 1.3;
    s.yaw = a;
    s.pitch = -0.45;
  });
  const box = (await page.locator(".gw-tag", { hasText: "la rana" }).boundingBox())!;
  const tap = () => page.mouse.click(box.x + box.width / 2, box.y + box.height + 25);
  const bubble = page.locator(".gw-say");
  await tap();
  await expect(bubble).toHaveText(/^croac… \p{L}+$/u);
  await tap();
  await expect(bubble).toHaveText(/^croac… \p{L}+$/u);
  await tap();
  await expect(bubble).toHaveText("¿Otra vez tú?");
  // A double tap skips nothing.
  await tap();
  await expect(bubble).toHaveText("¿Otra vez tú?");
  await gameSeconds(page, 2);
  await tap();
  await expect(bubble).toHaveText("No tengo más palabras.");
  // Long enough to read it slowly.
  await gameSeconds(page, 6);
  await expect(bubble).toHaveText("No tengo más palabras.");
  await tap();
  await expect(bubble).toHaveText("croac…");
});

test("visitors in the walk: the frog's tag at dusk, a tap croaks a known word, and by day it sleeps", async ({ page }) => {
  // Seven in the evening: the wall clock sets the time of day (#646).
  await page.clock.setFixedTime(new Date("2026-10-11T19:00:00"));
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await pinDetail(page, "normal");
  // What the page hands the browser's voice.
  await page.addInitScript(() => {
    const spoken: string[] = [];
    (window as unknown as { spoken: string[] }).spoken = spoken;
    speechSynthesis.speak = (u) => void spoken.push(u.text);
  });
  // The dev override brings every visitor; the dev-only scene handle lets the test stand by the pond.
  await page.goto("/?demo=es:30&visitors=all#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".gw")).toHaveClass(/\bgw-dusk\b/);
  const standByFrog = async () => {
    await page.waitForFunction(() => "__garden" in window);
    await page.evaluate(() => {
      type Sprite = { v: { id: string }; body: { at: { x: number; z: number } } };
      const s = (window as unknown as { __garden: { guests: { sprites: Sprite[] }; layout: { pond: { x: number; z: number } }; x: number; z: number; yaw: number; pitch: number } }).__garden;
      const frog = s.guests.sprites.find((o) => o.v.id === "frog")!.body.at;
      // 1.3 m from the frog, on the side away from the middle of the pond, looking at it.
      const a = Math.atan2(frog.x - s.layout.pond.x, frog.z - s.layout.pond.z);
      s.x = frog.x + Math.sin(a) * 1.3;
      s.z = frog.z + Math.cos(a) * 1.3;
      s.yaw = a;
      s.pitch = -0.45;
    });
  };
  await standByFrog();
  const tag = page.locator(".gw-tag", { hasText: "la rana" });
  await expect(tag).toHaveText("la rana · frog");
  const box = (await tag.boundingBox())!;
  const croak = page.waitForResponse(/frog-croak.*\.mp3$/);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 25);
  // Its sound and a word (the demo learner's words); never its own name.
  await expect(page.locator(".gw-say")).toHaveText(/^croac…/);
  await expect(page.locator(".gw-say")).not.toHaveText(/rana/);
  // Aloud, only a real recorded croak: never the course voice (#739).
  expect((await croak).ok()).toBe(true);
  // No event to wait for when nothing is spoken: give the croak (under 1 s) time to end.
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as unknown as { spoken: string[] }).spoken)).toEqual([]);
  // By day it stays, asleep on its pad, as in the strip: a learner who brought it finds it (#209).
  // Come back at noon the next day.
  await page.clock.setFixedTime(new Date("2026-10-12T12:00:00"));
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.locator(".gw")).toHaveClass(/\bgw-day\b/);
  await standByFrog();
  await expect(tag).toHaveText("la rana · frog");
  const frame = await page.evaluate(() => {
    type Sprite = { v: { id: string }; body: { frame: string } };
    return (window as unknown as { __garden: { guests: { sprites: Sprite[] } } }).__garden.guests.sprites.find((o) => o.v.id === "frog")!.body.frame;
  });
  expect(frame).toBe("asleep");
  expect(errors).toEqual([]);
});

test("the garden tab opens the garden; an empty garden offers the first session", async ({ page }) => {
  await startCourse(page);
  // The empty strip is not empty: a stake, and a worm that says its word (#58).
  await expect(page.locator(".garden-stake")).toHaveText("Reserved for Spanish wordsReservado");
  await page.getByRole("button", { name: "el gusano · worm" }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("el gusano · worm");
  await page.getByRole("tab", { name: "Garden" }).click();
  await expect(page.getByText("Nothing planted yet.")).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("button", { name: "Plant my first words" })).toBeVisible();
});

test("the ends of the strip: the first word's post at the left, the mole at the right (#61)", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  // The dev override brings the mole today, whatever the date.
  await page.goto("/?demo=es&visitors=all#/today");
  const strip = page.locator(".garden-scroll");
  await expect(page.locator(".garden-strip.scrolls")).toBeVisible({ timeout: 30_000 });
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
  await expect(page.locator(".garden-strip.scrolls")).toBeVisible({ timeout: 30_000 });
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
  await pinDetail(page, "normal");
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
  await pinDetail(page, "low");
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
      await pinDetail(page, "low");
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

// #334: one action button for what is in reach; its icon changes shape, and a screen reader hears what it does.
// docs/garden-play.md, "The bench" (#1011).
test("bench.sit: W toward the bench stops you at its back; the button sits you down, facing the pond; Stand up puts you in front of it, where S stops you; a step stands you up too", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  await pinDetail(page, "low");
  await page.goto("/?demo=es:30#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  type Bench = { x: number; z: number; walker: { kind: string }; camera: { position: { y: number } }; game: { bench: { x: number; z: number } } };
  const scene = () =>
    page.evaluate(() => {
      const s = (window as unknown as { __garden: Bench }).__garden;
      return { seated: s.walker.kind === "seated", eye: s.camera.position.y };
    });
  await expect(page.getByRole("button", { name: "Sit on the bench" })).toHaveCount(0);
  // On the garden side of the bench, facing it and the pond past it: forward is -z at yaw 0.
  const bench = await page.evaluate(() => {
    const s = (window as unknown as { __garden: Bench }).__garden;
    Object.assign(s, { x: s.game.bench.x, z: s.game.bench.z - 1.2, yaw: Math.PI, pitch: 0 });
    return s.game.bench;
  });
  // However long the key is held, you stop a walker's width from the bench's back (world.ts BENCH, WALKER).
  await page.keyboard.down("KeyW");
  await expect.poll(async () => (await walker(page)).z).toBeCloseTo(bench.z - BENCH.back - WALKER, 2);
  await page.keyboard.up("KeyW");
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
  // Up between the bench and the pond, facing the pond: S walks you back into the bench's front, and no farther.
  expect((await walker(page)).z).toBeGreaterThan(bench.z + BENCH.front + WALKER);
  await page.keyboard.down("KeyS");
  await expect.poll(async () => (await walker(page)).z).toBeCloseTo(bench.z + BENCH.front + WALKER, 2);
  await page.waitForTimeout(300);
  await page.keyboard.up("KeyS");
  expect((await walker(page)).z).toBeCloseTo(bench.z + BENCH.front + WALKER, 2);
  // Any step stands you up too.
  await sit.click();
  await expect(page.getByRole("button", { name: "Stand up" })).toBeVisible();
  await page.keyboard.down("KeyS");
  await page.waitForTimeout(150);
  await page.keyboard.up("KeyS");
  expect((await scene()).seated).toBe(false);
});

// docs/garden-play.md, "The action button" (#835).
test("action.none: on open ground away from everything no action button shows; walk up to the bench and it shows, named Sit on the bench", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  await page.setViewportSize({ width: 1280, height: 720 });
  await pinDetail(page, "low");
  await page.goto("/?demo=es:30#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  // A step in front of the bench (world.ts benchAt), your back to it: W walks you away from it.
  await page.evaluate(() => {
    const s = (window as unknown as { __garden: { layout: { pond: { x: number; z: number; r: number } } } }).__garden;
    const p = s.layout.pond;
    Object.assign(s, { x: p.x + 0.2, z: p.z - p.r - 1.6, yaw: 0, pitch: 0 });
  });
  const sit = page.getByRole("button", { name: "Sit on the bench" });
  const act = page.locator(".gw-act");
  await sit.focus();
  // Walk on, away from the bench and the pond (its pebbles), until nothing is in reach: the button goes, and focus goes back to the walk.
  await page.keyboard.down("KeyW");
  await expect(act).toHaveCount(0);
  await page.keyboard.up("KeyW");
  await expect(act).toHaveCount(0);
  await expect(page.locator(".gw-canvas")).toBeFocused();
  // Step back to it with S.
  await page.keyboard.down("KeyS");
  await expect(sit).toBeVisible();
  await page.keyboard.up("KeyS");
});

// docs/garden-play.md, "The action button" (#838). Steps of a few centimetres are set on the dev-only scene handle: a held key at 7 frames a second on CI cannot stop that exactly.
test("action.reach-edge: the bench comes into reach where Sit shows, and stays in reach a small step farther, so the button does not blink at the edge", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  await page.setViewportSize({ width: 1280, height: 720 });
  await pinDetail(page, "low");
  await page.goto("/?demo=es:30#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  // Stand `back` m from the bench's middle (world.ts benchAt), on open ground away from the pond, your back to it.
  const standBack = async (back: number) => {
    await page.evaluate((back) => {
      const s = (window as unknown as { __garden: { game: { bench: { x: number; z: number } } } }).__garden;
      Object.assign(s, { x: s.game.bench.x, z: s.game.bench.z - back, yaw: 0, pitch: 0 });
    }, back);
    await gameSeconds(page, 0.3);
  };
  const sit = page.getByRole("button", { name: "Sit on the bench" });
  const act = page.locator(".gw-act");
  // Just inside the bench's reach (reachCore.ts BENCH_REACH 1.6 m).
  await standBack(1.55);
  await expect(sit).toBeVisible();
  await standBack(1.7);
  await expect(sit).toBeVisible();
  await standBack(1.95);
  await expect(act).toHaveCount(0);
  await standBack(1.7);
  await expect(act).toHaveCount(0);
  await standBack(1.55);
  await expect(sit).toBeVisible();
});

// #362: sit still and the garden comes to you. Seconds sat are moved on through the dev-only scene handle, as a test cannot sit for a minute.
test("sitting still on the bench: the bird, the cat and the gnome come to sit with you, and time runs on to dusk; stand up and it is now again", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  await pinDetail(page, "low");
  // A dev-only override brings every visitor today.
  await page.goto("/?demo=es:30&visitors=all#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  type Sprite = { v: { id: string }; body: { at: { x: number; z: number } } };
  type Bench = {
    game: { sat: number; lapse: number; shown: string; bench: { x: number; z: number }; lamps: { dark: boolean; on: boolean[] } };
    guests: { sprites: Sprite[] };
    layout: { pond: { x: number; z: number; r: number } };
  };
  const scene = () =>
    page.evaluate(() => {
      const s = (window as unknown as { __garden: Bench }).__garden;
      const g = s.game;
      const bird = s.guests.sprites.find((v) => v.v.id === "bird")!.body.at;
      return { lapse: g.lapse, shown: g.shown, lit: g.lamps.dark && g.lamps.on.every(Boolean), birdFromBench: Math.hypot(bird.x - g.bench.x, bird.z - g.bench.z) };
    });
  const sat = (seconds: number) => page.evaluate((n) => Object.assign((window as unknown as { __garden: Bench }).__garden.game, { sat: n }), seconds);
  await page.evaluate(() => {
    const s = (window as unknown as { __garden: Bench }).__garden;
    const p = s.layout.pond;
    Object.assign(s, { x: p.x + 0.2, z: p.z - p.r - 1.6, yaw: 0, pitch: 0 });
  });
  const away = (await scene()).birdFromBench;
  expect(away).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Sit on the bench" }).click();
  const status = page.locator(".sr-only[role=status]");
  await expect(status).toHaveText("");

  // Facing the pond, nobody sees them come.
  await sat(9.9);
  await expect(status).toHaveText("A bird lands on the back of the bench.");
  expect((await scene()).birdFromBench).toBeLessThan(0.8);
  await sat(19.9);
  await expect(status).toHaveText("The cat sits beside you.");
  await sat(39.9);
  await expect(status).toHaveText("The gnome comes over. It says: Bonito.");
  // The gnome's word is said in the course language.
  await expect(status.locator("span[lang=es]")).toHaveText("Bonito.");

  // Time has run on to dusk: the lanterns are lit. The time of day from the wall clock stays as it was.
  await page.evaluate(() => Object.assign((window as unknown as { __garden: Bench }).__garden.game, { lapse: 0.9 }));
  await expect.poll(async () => (await scene()).shown).toBe("dusk");
  expect((await scene()).lit).toBe(true);
  await expect(page.locator(".gw")).toHaveClass(/\bgw-day\b/);

  // Stand up: time runs back to now, and the visitors go back to their places.
  await page.getByRole("button", { name: "Stand up" }).click();
  await expect.poll(async () => (await scene()).lapse).toBe(0);
  expect(await scene()).toEqual({ lapse: 0, shown: "day", lit: false, birdFromBench: away });
  await expect(status).toHaveText("");
});

// docs/garden-play.md, "Who comes to sit with you on the bench" (#802): you can watch each one come, and go.
test.describe(() => {
  test.use({ reducedMotion: "no-preference" });
  // On CI's software WebGL (~7 frames a second) the walk takes 10–20 s to open; then the visitors come in real time.
  test.describe.configure({ timeout: 90_000 });
  type Sprite = { v: { id: string }; home: [number, number, number]; body: { x: number; y: number; z: number; at: { x: number; y: number; z: number } } };
  type Bench = { game: { sat: number }; x: number; z: number; yaw: number; pitch: number; layout: { pond: { x: number; z: number; r: number } }; guests: { sprites: Sprite[] } };
  const status = (page: Page) => page.locator(".gw > .sr-only[role=status]");

  /** Open the walk with these visitors, and sit on the bench facing the pond. */
  async function sitDown(page: Page, visitors: string) {
    await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
    await pinDetail(page, "low");
    await page.goto(`/?demo=es:30&visitors=${visitors}#/today`);
    await page.getByRole("button", { name: "Walk in your garden" }).click();
    await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() => "__garden" in window);
    await page.evaluate(() => {
      const s = (window as unknown as { __garden: Bench }).__garden;
      const p = s.layout.pond;
      Object.assign(s, { x: p.x + 0.2, z: p.z - p.r - 1.6, yaw: 0, pitch: 0 });
    });
    await page.getByRole("button", { name: "Sit on the bench" }).click();
    await expect(page.getByRole("button", { name: "Stand up" })).toBeVisible();
  }
  const sat = (page: Page, n: number) => page.evaluate((n) => Object.assign((window as unknown as { __garden: Bench }).__garden.game, { sat: n }), n);
  /** How far a visitor is drawn from its own place (m). */
  const fromHome = (page: Page, id: string) =>
    page.evaluate((id) => {
      const g = (window as unknown as { __garden: Bench }).__garden.guests.sprites.find((o) => o.v.id === id)!;
      return Math.hypot(g.body.x - g.home[0], g.body.y - g.home[1], g.body.z - g.home[2]);
    }, id);

  test("visit.bench-walk: the bird and the cat come to the bench a short step at a time, the cat never over a bed, and go home the same way", async ({ page }) => {
    await sitDown(page, "bird,cat");
    await trackVisitors(page, ["bird", "cat"]);
    await sat(page, 9.9);
    await expect(status(page)).toHaveText("A bird lands on the back of the bench.", { timeout: 30_000 });
    await sat(page, 19.9);
    await expect(status(page)).toHaveText("The cat sits beside you.", { timeout: 30_000 });
    const far = { bird: await fromHome(page, "bird"), cat: await fromHome(page, "cat") };
    await page.getByRole("button", { name: "Stand up" }).click();
    for (const id of ["bird", "cat"] as const) await expect.poll(() => fromHome(page, id), { timeout: 30_000 }).toBeLessThan(0.01);
    for (const id of ["bird", "cat"] as const) {
      const way = await trackOf(page, id);
      expect(way.step, id).toBeLessThan(0.6);
      // There and back, all the way.
      expect(way.went, id).toBeGreaterThanOrEqual(2 * far[id] - 0.01);
      if (id === "cat") expect(way.inBed).toBe(0);
    }
  });

  test("visit.gnome-statues: the gnome comes to the bench, but never moves while it is on screen", async ({ page }) => {
    await sitDown(page, "gnome");
    await trackVisitors(page, ["gnome"]);
    await sat(page, 39.9);
    // Look at it: it stays as still as a statue.
    const lookAt = () =>
      page.evaluate(() => {
        const s = (window as unknown as { __garden: Bench }).__garden;
        const g = s.guests.sprites.find((o) => o.v.id === "gnome")!.body;
        // Forward is -z at yaw 0.
        Object.assign(s, { yaw: Math.atan2(-(g.x - s.x), -(g.z - s.z)), pitch: -0.2 });
        return [g.x, g.z];
      });
    await gameSeconds(page, 0.5);
    const seen = await lookAt();
    await gameSeconds(page, 2);
    expect(await lookAt()).toEqual(seen);
    // Look away, back at the pond: it comes.
    await page.evaluate(() => Object.assign((window as unknown as { __garden: Bench }).__garden, { yaw: Math.PI, pitch: 0.1 }));
    await expect(status(page)).toHaveText("The gnome comes over. It says: Bonito.", { timeout: 60_000 });
    const way = await trackOf(page, "gnome");
    expect(way.step).toBeLessThan(0.3);
    expect(way.went).toBeGreaterThan(1);
  });
});

test("the controls hint shows in the learner's walk until they first move; the landing page's walk does not use it up (#334)", async ({ page }) => {
  await pinDetail(page, "low");
  const hint = page.locator(".gw-hint");
  const walkIn = async () => {
    await page.getByRole("button", { name: "Walk in your garden" }).click();
    await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() => "__garden" in window);
  };
  // The landing page's walk: the hint shows, and moving there does not use up the learner's.
  await page.goto("/");
  await page.getByRole("button", { name: "Walk through this garden in 3D" }).click();
  await expect(hint).toContainText("Walk:", { timeout: 20_000 });
  await page.keyboard.press("KeyW");
  await expect(hint).toHaveCount(0);
  // The learner's own walk: the hint stays until they move, even across walks.
  await page.goto("/?demo=es:30#/today");
  await walkIn();
  await expect(hint).toContainText("Walk:");
  await page.getByRole("button", { name: "Back" }).click();
  await walkIn();
  await expect(hint).toContainText("Walk:");
  await page.keyboard.press("KeyW");
  await expect(hint).toHaveCount(0);
  await page.getByRole("button", { name: "Back" }).click();
  await walkIn();
  await expect(hint).toHaveCount(0);
});

// #876: with motion, Next plant glides to the plant; with reduced motion it is a cut, and there is no glide to stop.
test.describe(() => {
  test.use({ reducedMotion: "no-preference" });
  test("a tap on a near plant during the glide to another opens its card, and the glide stops where you are (#876)", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
    await pinDetail(page, "low");
    await page.goto("/?demo=es:30#/today");
    await page.getByRole("button", { name: "Walk in your garden" }).click();
    await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
    await page.waitForFunction(() => "__garden" in window);
    type P = { lemma: string; x: number; z: number };
    type Glide = { x: number; z: number; walker: { kind: string }; layout: { plants: P[] }; select(p: P, walkTo: boolean): void; tap(hit: { kind: "plant"; p: P }, known: string[]): void };
    const kind = () => page.evaluate(() => (window as unknown as { __garden: Glide }).__garden.walker.kind);
    const card = page.getByRole("dialog", { name: /^The plant for / });
    // Glide to the first plant (as Next plant does), and stand there.
    await page.evaluate(() => {
      const s = (window as unknown as { __garden: Glide }).__garden;
      s.select(s.layout.plants[0], true);
    });
    await expect.poll(kind).toBe("free");
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    // The glide to the plant farthest away starts; before a frame moves you, a tap on the plant nearest you.
    const at = await page.evaluate(() => {
      const s = (window as unknown as { __garden: Glide }).__garden;
      const from = (q: P) => Math.hypot(q.x - s.x, q.z - s.z);
      const near = s.layout.plants.reduce((a, p) => (from(p) < from(a) ? p : a));
      const far = s.layout.plants.reduce((a, p) => (from(p) > from(a) ? p : a));
      const start = { x: s.x, z: s.z, near: near.lemma, by: from(near), far: from(far) };
      s.select(far, true);
      s.tap({ kind: "plant", p: near }, []);
      return start;
    });
    // NAME_NEAR (scenePlants.ts): the near plant's name shows, so a tap opens its card where you stand.
    expect(at.by).toBeLessThan(3.2);
    expect(at.far).toBeGreaterThan(4);
    await expect(card).toHaveAttribute("aria-label", `The plant for ${at.near}`);
    // A glide takes 1.8 s at most: wait longer, in game time. You are still where you tapped.
    await gameSeconds(page, 2.5);
    expect(await kind()).toBe("free");
    const now = await page.evaluate(() => {
      const s = (window as unknown as { __garden: Glide }).__garden;
      return { x: s.x, z: s.z };
    });
    expect(Math.hypot(now.x - at.x, now.z - at.z)).toBeLessThan(0.01);
    await expect(card).toHaveAttribute("aria-label", `The plant for ${at.near}`);
  });
});
