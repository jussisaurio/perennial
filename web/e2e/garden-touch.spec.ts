import { expect, test, type Page } from "./test";
import { aimAtGround, arrives, plantNearMiddle, settledGardenWidth, standAtDoor, standByLeave, walker, type WalkScene } from "./helpers";

// Runs on the iPhone (WebKit) project only. Playwright's tap sends a whole tap
// in one go, so React never renders between touchdown and lift; a real finger
// holds for a moment. This taps in iOS order with that hold: over, enter and
// down; then up, out and leave (a touch leaves on lift); then the click.
async function fingerTap(page: Page, x: number, y: number) {
  await page.evaluate(
    async ([x, y]) => {
      const at = document.elementFromPoint(x, y)!;
      const o = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, pointerType: "touch", pointerId: 2, isPrimary: true };
      const hold = () => new Promise((r) => setTimeout(r, 80));
      for (const t of ["pointerover", "pointerenter", "pointerdown"]) at.dispatchEvent(new PointerEvent(t, { ...o, bubbles: t !== "pointerenter" }));
      await hold();
      for (const t of ["pointerup", "pointerout", "pointerleave"]) at.dispatchEvent(new PointerEvent(t, { ...o, bubbles: t !== "pointerleave" }));
      await hold();
      // The click goes to whatever is under the finger now.
      document.elementFromPoint(x, y)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    },
    [x, y],
  );
}

test("iPhone: a tapped plant's card stays open, and its link opens the 3D garden (#113)", async ({ page }) => {
  await page.goto("/?demo=es#/today");
  await expect(page.locator(".garden.scrolls")).toBeVisible({ timeout: 30_000 });
  await settledGardenWidth(page);
  await fingerTap(page, ...(await plantNearMiddle(page)));
  const card = page.locator(".plant-tip");
  await expect(card).toBeVisible();
  const word = (await card.locator("strong").textContent())!;
  // Before #113 the lift closed the card, so this click fell through to the plant beneath.
  const link = (await card.getByRole("button", { name: /View in garden/ }).boundingBox())!;
  await fingerTap(page, link.x + link.width / 2, link.y + link.height / 2);
  await expect(page.getByRole("dialog", { name: `The plant for ${word}` })).toBeVisible({ timeout: 20_000 });
});

/** The demo learner's walk, at a fixed day and hour (visitors change by day), in low quality (software WebGL draws it faster). */
async function openWalk(page: Page) {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
  await page.goto("/?demo=es:30#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
}

test("iPhone: a finger's tap on the locked door in the walk says it is locked (#315)", async ({ page }) => {
  await openWalk(page);
  await fingerTap(page, ...(await standAtDoor(page)));
  await expect(page.locator(".gw-say")).toHaveText("Locked.");
});

test("iPhone: one finger carries the crumbs from the basket to the bowl (#351)", async ({ page }) => {
  await openWalk(page);
  const left = () => page.evaluate(() => (window as unknown as { __garden: { leaveIt: { left: { n: number }; hand: unknown } } }).__garden.leaveIt);
  // A tap on the basket from afar walks up to it and takes the crumbs; a tap on the bowl walks there and leaves them.
  await fingerTap(page, ...(await standByLeave(page, "basket", 3)));
  await expect.poll(async () => !!(await left()).hand, { timeout: 15_000 }).toBe(true);
  await fingerTap(page, ...(await standByLeave(page, "bowl", 3)));
  await expect.poll(async () => (await left()).left.n, { timeout: 15_000 }).toBe(1);
});

test("iPhone: tap the ground to walk there (#336)", async ({ page }) => {
  await openWalk(page);
  const { x, y, to, kind } = await aimAtGround(page, 0);
  expect(kind).toBe("walk");
  await fingerTap(page, x, y);
  expect((await walker(page)).walking).toBe(true);
  await arrives(page, to);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("iPhone: tap a plant far away: walk there, and its card opens (#336)", async ({ page }) => {
  await openWalk(page);
  // On the path beside the first bed, looking down the garden: a plant in a bed further back that a tap meets first.
  const far = await page.evaluate(
    () =>
      new Promise<{ x: number; y: number; lemma: string } | null>((done) => {
        const s = (window as unknown as { __garden: WalkScene }).__garden;
        const bed = s.layout.beds[0];
        Object.assign(s, { x: bed.x + bed.w / 2 + 0.95, z: bed.z + bed.d / 2 + 2, yaw: 0, pitch: -0.1 });
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
            for (const p of s.layout.plants.filter((p) => p.bed > 0)) {
              const v = new s.tmp.constructor(p.x, 0.5, p.z).project(s.camera);
              const [x, y] = [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height];
              // Clear of the top bar, the hint and the buttons at the bottom.
              if (x < 20 || x > r.width - 20 || y < 140 || y > r.height - 200) continue;
              const hit = s.pickAny(x, y, r.width, r.height);
              if (hit?.kind === "plant" && hit.p!.id === p.id) return done({ x: r.left + x, y: r.top + y, lemma: p.lemma });
            }
            done(null);
          }),
        );
      }),
  );
  expect(far, "a plant in a far bed, in view").not.toBeNull();
  await fingerTap(page, far!.x, far!.y);
  // It walks there first: no card yet.
  expect((await walker(page)).walking).toBe(true);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: `The plant for ${far!.lemma}` })).toBeVisible({ timeout: 20_000 });
  // It stands on the path in front of the plant's bed, not in any bed.
  const at = await walker(page);
  const beds = await page.evaluate(() => (window as unknown as { __garden: WalkScene }).__garden.layout.beds);
  expect(beds.some((b) => Math.abs(at.x - b.x) < b.w / 2 && Math.abs(at.z - b.z) < b.d / 2)).toBe(false);
});

test("iPhone: the thumb stick still walks, and takes over from a walk under way (#336)", async ({ page }) => {
  await openWalk(page);
  const { x, y, to } = await aimAtGround(page, 0);
  const start = await walker(page);
  await fingerTap(page, x, y);
  expect((await walker(page)).walking).toBe(true);
  const stick = (await page.locator(".gw-stick").boundingBox())!;
  // A finger pulls the stick back for a moment, then lets go: the walk stops, and you step back, away from where it went.
  await page.evaluate(
    async ([cx, cy]) => {
      const el = document.querySelector(".gw-stick")!;
      const o = { bubbles: true, cancelable: true, composed: true, pointerType: "touch", pointerId: 3, isPrimary: true };
      el.dispatchEvent(new PointerEvent("pointerdown", { ...o, clientX: cx, clientY: cy }));
      el.dispatchEvent(new PointerEvent("pointermove", { ...o, clientX: cx, clientY: cy + 40 }));
      await new Promise((r) => setTimeout(r, 600));
      el.dispatchEvent(new PointerEvent("pointerup", { ...o, clientX: cx, clientY: cy + 40 }));
    },
    [stick.x + stick.width / 2, stick.y + stick.height / 2],
  );
  const after = await walker(page);
  expect(after.walking).toBe(false);
  expect(Math.hypot(after.x - to.x, after.z - to.z)).toBeGreaterThan(Math.hypot(start.x - to.x, start.z - to.z));
});
