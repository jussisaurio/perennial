import { expect, test, type Page } from "./test";
import { pinDetail } from "./helpers";

// #377, call: with nothing in reach the action button whistles, and each
// visitor in sight answers in its own way. A long press on open ground calls
// too. The visitors are named in the URL: the gnome (hiding, on this day), the frog, the dog and (at dusk
// and night) the moth. The demo's own visitors change with its review history: since #704 its 400 words
// no longer bring the dog.

type CallScene = {
  x: number;
  z: number;
  pitch: number;
  guests: { sprites: { v: { id: string }; body: { x: number; z: number } }[] };
};

async function openWalk(page: Page) {
  await page.goto("/?demo=es:400&visitors=gnome,frog,moth,dog#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
}

// The visitors' answers, read out; not the loading line, which stays up while the plants are drawn in the background (#470).
const status = (page: Page) => page.locator(".gw > .sr-only[role=status]");

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  await page.setViewportSize({ width: 1280, height: 720 });
  // Low detail: software WebGL on CI draws it faster, and every click waits for frames.
  await pinDetail(page, "low");
});

test("with nothing in reach the action button calls: the dog comes to your feet, and a screen reader hears who answered", async ({ page }) => {
  await openWalk(page);
  const call = page.getByRole("button", { name: "Call" });
  // An icon only (#334): the name is for screen readers.
  await expect(call).toHaveText("");
  await call.click();
  // In the order they are listed; the moth is out only at dusk and night, so it is not asked by day. The frog sleeps by day.
  // On this day the gnome hides (#379), and keeps quiet: a call must not give it away.
  await expect(status(page)).toHaveText("The frog croaks once in its sleep. The dog runs over, tail going.");
  // Reduced motion (the e2e default): the dog is at your feet at once, not at its plant on the far side of the garden.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = (window as unknown as { __garden: CallScene }).__garden;
        const dog = s.guests.sprites.find((g) => g.v.id === "dog")!;
        return Math.hypot(dog.body.x - s.x, dog.body.z - s.z);
      }),
    )
    .toBeLessThan(1);
  // The button stays: it always does something.
  await expect(call).toBeFocused();
});

test("at night a long press on open ground calls too, and the moth does not leave its lantern", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-11T23:00:00"));
  await openWalk(page);
  await expect(page.locator(".gw")).toHaveClass(/\bgw-night\b/);
  // Look down at the path ahead, and press and hold on it.
  await page.evaluate(() => Object.assign((window as unknown as { __garden: CallScene }).__garden, { pitch: -0.5 }));
  const box = (await page.locator(".gw-canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.8);
  await page.mouse.down();
  await expect(status(page)).toContainText("The moth does not leave its lantern.");
  await page.mouse.up();
  // Awake at night, the frog croaks back; no card opened, and no walk started.
  await expect(status(page)).toContainText("The frog croaks back.");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

// docs/garden-play.md, "Calling a visitor" (#761): the dog finds its way on foot like you do.
type Dog = { x: number; z: number; at: { x: number; z: number } };
type WayScene = { x: number; z: number; layout: unknown; ground: unknown; door: { state: string }; guests: { sprites: { v: { id: string }; body: Dog }[] } };
type Bed = { x: number; z: number; w: number; d: number };

/** Stand on the far side of the bed nearest the dog, facing it, and record where the dog is on every frame. */
async function behindBed(page: Page) {
  await expect(page.locator(".gw-loading")).toHaveCount(0, { timeout: 30_000 });
  await page.evaluate(async () => {
    const { standAt } = await import(/* @vite-ignore */ "/src/garden/ground.ts");
    const w = window as unknown as { __garden: WayScene; __dogTrack: [number, number][] };
    const s = w.__garden;
    const dog = s.guests.sprites.find((g) => g.v.id === "dog")!.body;
    const bed = (s.layout as { beds: Bed[] }).beds.reduce((a, b) => (Math.hypot(b.x - dog.x, b.z - dog.z) < Math.hypot(a.x - dog.x, a.z - dog.z) ? b : a));
    const d = Math.hypot(bed.x - dog.x, bed.z - dog.z);
    const reach = Math.hypot(bed.w, bed.d) / 2 + 1.5;
    const ground = s.ground as Parameters<typeof standAt>[0];
    const at = standAt(ground, bed.x + ((bed.x - dog.x) / d) * reach, bed.z + ((bed.z - dog.z) / d) * reach);
    // Forward is -z at yaw 0.
    Object.assign(s, { x: at.x, z: at.z, yaw: Math.atan2(-(dog.x - at.x), -(dog.z - at.z)) });
    w.__dogTrack = [];
    const track = () => {
      w.__dogTrack.push([dog.x, dog.z]);
      requestAnimationFrame(track);
    };
    track();
  });
}

/** How many recorded frames had the dog inside a bed, the pond, the well or the hedge. */
const throughWalls = (page: Page) =>
  page.evaluate(async () => {
    const { collide } = await import(/* @vite-ignore */ "/src/garden/world.ts");
    const w = window as unknown as { __garden: WayScene; __dogTrack: [number, number][] };
    const s = w.__garden;
    // A hair of radius: a body exactly on an edge is not inside.
    return w.__dogTrack.filter(([x, z]) => {
      const p = collide(s.layout as Parameters<typeof collide>[0], x, z, 0.02, s.door.state === "open");
      return Math.hypot(p.x - x, p.z - z) > 1e-6;
    }).length;
  });

const theDog = (page: Page, from: "you" | "home") =>
  page.evaluate((from) => {
    const s = (window as unknown as { __garden: WayScene }).__garden;
    const dog = s.guests.sprites.find((g) => g.v.id === "dog")!.body;
    return from === "you" ? Math.hypot(dog.x - s.x, dog.z - s.z) : Math.hypot(dog.x - dog.at.x, dog.z - dog.at.z);
  }, from);

async function whistle(page: Page) {
  await page.getByRole("button", { name: "Call" }).focus();
  await page.keyboard.press("Enter");
  await expect(status(page)).toContainText("The dog runs over, tail going.");
}

test.describe(() => {
  // The dog is seen running, not put at your feet at once.
  test.use({ reducedMotion: "no-preference" });
  // On CI's software WebGL (~7 frames a second) the walk takes 10–20 s to open; then the dog runs, stays 6 s and trots home in real time.
  test.describe.configure({ timeout: 60_000 });

  test("call.dog-round: with a bed between you and the dog, the dog runs round the bed to you and is never on the bed", async ({ page }) => {
    await openWalk(page);
    await behindBed(page);
    expect(await theDog(page, "you")).toBeGreaterThan(2);
    await whistle(page);
    await expect.poll(() => theDog(page, "you"), { timeout: 15_000 }).toBeLessThan(1);
    expect(await throughWalls(page)).toBe(0);
  });

  test("call.dog-home: a few seconds after it reaches you, the dog trots back to its own place, again never over a bed", async ({ page }) => {
    await openWalk(page);
    await behindBed(page);
    await whistle(page);
    await expect.poll(() => theDog(page, "you"), { timeout: 15_000 }).toBeLessThan(1);
    await expect.poll(() => theDog(page, "home"), { timeout: 30_000 }).toBeLessThan(0.01);
    expect(await throughWalls(page)).toBe(0);
  });
});
