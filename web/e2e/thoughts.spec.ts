import { expect, test, type Page } from "./test";
import type { WalkScene } from "./helpers";
import { gameSeconds, pinDetail, walker } from "./helpers";

// docs/garden-play.md, "Thoughts: a tap on a thing" (#864): a tap on the bench, the pond, the sunflower, the sundial, the stool or
// the far hills shows a short line under its name, in the course language, from the words the learner knows.

type ThoughtScene = WalkScene & {
  pitch: number;
  bench: { x: number; z: number };
  layout: { pond: { x: number; z: number; r: number } };
  pickAny(x: number, y: number, w: number, h: number): { kind: string; s?: { view: { id: string } } } | null;
};

const BENCH = "Alguien se sentaba aquí cada tarde.";
const tag = (page: Page) => page.locator(".gw-thought");
const status = (page: Page) => page.locator(".sr-only[role=status]");

/** Open the walk for a demo learner who knows exactly `known` words (dev/boot.ts). */
async function openWalk(page: Page, known: number) {
  // No visitors (an id that is none): a cat on the bench would take the tap.
  await page.goto(`/?demo=es:known:${known}&visitors=none#/today`);
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  // The key lies by the bench for one learner in five (world.ts keySpot, seeded by the demo's new user id), and in
  // reach it takes the action button from the bench: lay it by the first bed instead. With few words there is no key yet.
  await page.evaluate(() => {
    const s = (window as unknown as { __garden: { layout: { beds: { x: number; z: number; d: number }[] }; door: { key: { x: number; z: number } | null } } }).__garden;
    const bed = s.layout.beds[0];
    if (s.door.key) Object.assign(s.door.key, { x: bed.x + 1.2, z: bed.z + bed.d / 2 + 1 });
  });
}

/** Where things are: the bench's seat and the sundial by it. */
const places = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __garden: ThoughtScene }).__garden;
    return {
      bench: { x: s.bench.x, y: 0.45, z: s.bench.z },
      sundial: { x: s.bench.x - 1.05, y: 0.5, z: s.bench.z },
    };
  });

/** Stand `metres` from a point, on its garden side (-z), facing it; return where it shows on the page (pixels). */
const lookAt = (page: Page, p: { x: number; y: number; z: number }, metres: number) =>
  page.evaluate(
    ({ p, metres }) => {
      const s = (window as unknown as { __garden: ThoughtScene }).__garden;
      // Forward is -z at yaw 0: yaw π faces +z.
      Object.assign(s, { x: p.x, z: p.z - metres, yaw: Math.PI, pitch: -Math.atan2(1.05 - p.y, metres) });
      return new Promise<[number, number]>((done) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const v = new s.tmp.constructor(p.x, p.y, p.z).project(s.camera);
            const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
            done([r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]);
          }),
        ),
      );
    },
    { p, metres },
  );

/** Stand 3 m from the pond, on whichever side a tap on its middle meets the water (its lilies, the hedge or the bench are in the way on some); return that point on the page. */
const facePond = (page: Page) =>
  page.evaluate(async () => {
    const s = (window as unknown as { __garden: ThoughtScene }).__garden;
    const p = s.layout.pond;
    const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
    const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
      // Forward is (-sin yaw, -cos yaw): standing at p + 3·(sin a, cos a), yaw a faces the pond.
      Object.assign(s, { x: p.x + 3 * Math.sin(a), z: p.z + 3 * Math.cos(a), yaw: a, pitch: -Math.atan2(1.05, 3) });
      await frame();
      for (const off of [0, 0.4, -0.4]) {
        const v = new s.tmp.constructor(p.x + off * Math.cos(a), 0, p.z - off * Math.sin(a)).project(s.camera);
        const [x, y] = [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height];
        const hit = s.pickAny(x, y, r.width, r.height);
        if (hit?.kind === "scenery" && hit.s?.view.id === "pond") return [r.left + x, r.top + y] as [number, number];
      }
    }
    throw new Error("no clear view of the pond");
  });

test.beforeEach(async ({ page }) => {
  // Three in the afternoon.
  await page.clock.setFixedTime(new Date("2026-06-01T15:00:00"));
  await page.setViewportSize({ width: 1280, height: 720 });
  // Low detail: software WebGL on CI draws it faster, and every click waits for frames.
  await pinDetail(page, "low");
});

test("thought.tap: with 800 words a tap on the bench shows its name and newest line, the status says both, and you have not moved", async ({ page }) => {
  await openWalk(page, 800);
  const at = await lookAt(page, (await places(page)).bench, 2);
  const before = await walker(page);
  await page.mouse.click(...at);
  await expect(tag(page)).toContainText("el banco");
  await expect(page.locator(".gw-thought-line")).toHaveText(BENCH);
  await expect(status(page)).toHaveText(`el banco: ${BENCH}`);
  expect(await walker(page)).toMatchObject({ x: before.x, z: before.z, walking: false });
});

test("thought.early: with 3 words a tap on the bench shows only its name", async ({ page }) => {
  await openWalk(page, 3);
  await page.mouse.click(...(await lookAt(page, (await places(page)).bench, 2)));
  await expect(page.locator(".gw-tag").filter({ hasText: "el banco" })).toBeVisible();
  await expect(tag(page)).toHaveCount(0);
});

test("thought.grows: the pond shows a new line at 200, 700 and 1800 words", async ({ page }) => {
  const lines: string[] = [];
  for (const known of [200, 700, 1800]) {
    await openWalk(page, known);
    await page.mouse.click(...(await facePond(page)));
    await expect(tag(page)).toContainText("el estanque");
    lines.push(await page.locator(".gw-thought-line").innerText());
  }
  expect(lines).toEqual(["Hay un pez. O dos.", "Los peces suben. Buscan a alguien.", "Los peces aún esperan su pan."]);
});

test("thought.only-tap: standing by the bench shows no line; while one shows, W walks on and the button still says Sit on the bench", async ({ page }) => {
  await openWalk(page, 800);
  const at = await lookAt(page, (await places(page)).bench, 1);
  const sit = page.getByRole("button", { name: "Sit on the bench" });
  await expect(sit).toBeVisible();
  await gameSeconds(page, 10);
  await expect(tag(page)).toHaveCount(0);

  await page.mouse.click(...at);
  await expect(page.locator(".gw-thought-line")).toHaveText(BENCH);
  await expect(sit).toBeVisible();
  const before = await walker(page);
  await page.keyboard.down("KeyW");
  await expect.poll(async () => Math.abs((await walker(page)).z - before.z)).toBeGreaterThan(0.1);
  await page.keyboard.up("KeyW");
  await expect(tag(page)).toBeVisible();
});

test("thought.replace: a tap on the pond while the bench's line shows shows the pond's tag and line instead", async ({ page }) => {
  await openWalk(page, 800);
  const at = await places(page);
  await page.mouse.click(...(await lookAt(page, at.bench, 2)));
  await expect(page.locator(".gw-thought-line")).toHaveText(BENCH);
  await page.mouse.click(...(await facePond(page)));
  await expect(tag(page)).toHaveCount(1);
  await expect(tag(page)).toContainText("el estanque");
  await expect(page.locator(".gw-thought-line")).toHaveText("Los peces suben. Buscan a alguien.");
});

test("thought.seated: sitting on the bench, a tap on the pond shows the pond's tag and line, and you are still sitting", async ({ page }) => {
  await openWalk(page, 800);
  await lookAt(page, (await places(page)).bench, 1);
  await page.getByRole("button", { name: "Sit on the bench" }).click();
  const stand = page.getByRole("button", { name: "Stand up" });
  await expect(stand).toBeVisible();
  // From the seat, without turning: a point on the pond that a tap meets (a lily may be in the way of its middle).
  const at = await page.evaluate(async () => {
    const s = (window as unknown as { __garden: ThoughtScene }).__garden;
    const p = s.layout.pond;
    const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    for (const off of [0, 0.4, -0.4, 0.8, -0.8]) {
      const v = new s.tmp.constructor(p.x + off, 0, p.z).project(s.camera);
      const [x, y] = [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height];
      const hit = s.pickAny(x, y, r.width, r.height);
      if (hit?.kind === "scenery" && hit.s?.view.id === "pond") return [r.left + x, r.top + y] as [number, number];
    }
    throw new Error("no tap from the seat meets the pond");
  });
  await page.mouse.click(...at);
  await expect(tag(page)).toContainText("el estanque");
  await expect(page.locator(".gw-thought-line")).toHaveText("Los peces suben. Buscan a alguien.");
  await expect(stand).toBeVisible();
});

test("thought.details: up close, the bench's seat shows two cup rings and the sundial's stone two small letters", async ({ page }) => {
  await openWalk(page, 800);
  // The loading line sits in the middle of the view, over what we look at, and changes as the plants stream in.
  await expect(page.locator(".gw-loading")).toHaveCount(0, { timeout: 30_000 });
  // Stand `metres` from a named thing, on its `side` (+1: +z, the pond's side of the bench; -1: -z), looking down at it.
  // Return a small square of the page round it: shown and hidden, the drawing there must differ.
  const near = (name: string, side: 1 | -1, metres: number) =>
    page.evaluate(
      async ({ name, side, metres }) => {
        type Obj = { visible: boolean; getWorldPosition(v: unknown): { x: number; y: number; z: number; project(c: unknown): { x: number; y: number } } };
        const s = (window as unknown as { __garden: ThoughtScene & { scene: { getObjectByName(n: string): Obj | undefined } } }).__garden;
        const o = s.scene.getObjectByName(name);
        if (!o) throw new Error(`nothing named ${name}`);
        const p = o.getWorldPosition(new s.tmp.constructor(0, 0, 0));
        // Forward is -z at yaw 0.
        Object.assign(s, { x: p.x, z: p.z + side * metres, yaw: side > 0 ? 0 : Math.PI, pitch: -Math.atan2(1.05 - p.y, metres) });
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const v = new s.tmp.constructor(p.x, p.y, p.z).project(s.camera);
        const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width - 20, y: r.top + ((1 - v.y) / 2) * r.height - 20, width: 40, height: 40 };
      },
      { name, side, metres },
    );
  const show = (name: string, visible: boolean) =>
    page.evaluate(
      ({ name, visible }) =>
        new Promise<void>((done) => {
          const s = (window as unknown as { __garden: { scene: { getObjectByName(n: string): { visible: boolean } } } }).__garden;
          s.scene.getObjectByName(name).visible = visible;
          requestAnimationFrame(() => requestAnimationFrame(() => done()));
        }),
      { name, visible },
    );
  for (const [name, side, metres] of [
    ["cup rings", 1, 0.8],
    ["carved letters", -1, 0.7],
  ] as const) {
    const clip = await near(name, side, metres);
    const shown = await page.screenshot({ clip });
    // Nothing else moves there: the same view shows the same picture.
    expect(await page.screenshot({ clip })).toEqual(shown);
    await show(name, false);
    expect(await page.screenshot({ clip })).not.toEqual(shown);
    await show(name, true);
  }
});

test("thought.fades: the tag and its line still show 8 seconds after the tap and are gone 12 seconds after it", async ({ page }) => {
  await openWalk(page, 800);
  await page.mouse.click(...(await lookAt(page, (await places(page)).bench, 2)));
  await expect(tag(page)).toBeVisible();
  await gameSeconds(page, 8);
  await expect(page.locator(".gw-thought-line")).toHaveText(BENCH);
  await gameSeconds(page, 4);
  await expect(tag(page)).toHaveCount(0);
});

test("thought.hills: with 800 words a tap on the far hills shows their tag and a line", async ({ page }) => {
  await openWalk(page, 800);
  // From the bench, look round until a point a little above the horizon meets the hills, not a tree or the sky.
  const at = await page.evaluate(async () => {
    const s = (window as unknown as { __garden: ThoughtScene }).__garden;
    const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
    const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.4) {
      Object.assign(s, { x: s.bench.x, z: s.bench.z - 1, yaw, pitch: 0 });
      await frame();
      for (let y = 0.5; y > 0.3; y -= 0.02) {
        const hit = s.pickAny(r.width / 2, r.height * y, r.width, r.height);
        if (hit?.kind === "scenery" && hit.s?.view.id === "hills") return [r.left + r.width / 2, r.top + r.height * y] as [number, number];
      }
    }
    throw new Error("no view of the hills from the bench");
  });
  await page.mouse.click(...at);
  await expect(tag(page)).toContainText("las colinas");
  await expect(page.locator(".gw-thought-line")).toHaveText("Desde allí, esto se ve pequeño.");
});

test("thought.sundial-night: by day a tap on the sundial shows its line; at night it says it is closed, with no line", async ({ page }) => {
  await openWalk(page, 800);
  await page.mouse.click(...(await lookAt(page, (await places(page)).sundial, 1.5)));
  await expect(tag(page)).toContainText("el reloj de sol");
  await expect(page.locator(".gw-thought-line")).toHaveText("Sin sol, no hay hora.");

  // Eleven at night.
  await page.clock.setFixedTime(new Date("2026-06-01T23:00:00"));
  await page.getByRole("button", { name: "Back" }).click();
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await page.waitForFunction(() => "__garden" in window);
  await page.mouse.click(...(await lookAt(page, (await places(page)).sundial, 1.5)));
  await expect(page.locator(".gw-say")).toHaveText("Reloj de sol: cerrado hasta el amanecer.");
  await expect(tag(page)).toHaveCount(0);
});

test("thought.stool: with 800 words, on the hill, a tap on the stool shows its tag and a line, and you have not moved", async ({ page }) => {
  await openWalk(page, 800);
  // 1.5 m behind the stool, facing the far house over it: look down the middle of the view until a tap meets the stool.
  const at = await page.evaluate(async () => {
    const stile = await import(/* @vite-ignore */ "/src/garden/stile.ts");
    const lookout = await import(/* @vite-ignore */ "/src/garden/lookout.ts");
    const s = (window as unknown as { __garden: ThoughtScene }).__garden;
    const hill = lookout.lookoutAt(stile.stileAt(s.layout as Parameters<typeof stile.stileAt>[0]));
    Object.assign(s, { x: hill.stool[0] + Math.sin(hill.face) * 1.5, z: hill.stool[1] + Math.cos(hill.face) * 1.5, yaw: hill.face, pitch: -0.45 });
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
    const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
    for (let y = 0.3; y < 0.9; y += 0.02) {
      const hit = s.pickAny(r.width / 2, r.height * y, r.width, r.height);
      if (hit?.kind === "scenery" && hit.s?.view.id === "stool") return [r.left + r.width / 2, r.top + r.height * y] as [number, number];
    }
    throw new Error("no view of the stool");
  });
  const before = await walker(page);
  await page.mouse.click(...at);
  await expect(tag(page)).toContainText("el taburete");
  await expect(page.locator(".gw-thought-line")).toHaveText("Es para uno.");
  expect(await walker(page)).toMatchObject({ x: before.x, z: before.z, walking: false });
});
