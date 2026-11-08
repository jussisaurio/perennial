import { expect, test, type Page } from "./test";
import { pinDetail } from "./helpers";

// The mouse door and the last note (#882, docs/garden-play.md "The mouse door
// and the last note"): one test per claim. Only where the learner stands is set
// by hand. The clock is pinned to a night, when the lantern by the gate is lit
// and in reach of the mat too; the viewport to a laptop's.

const NIGHT = new Date("2026-09-26T22:00:00");
/** Known words when the last note comes (notes/es.ts n13). */
const DOOR = 940;

/** The parts of the dev-only scene handle (window.__garden) these tests read and move. */
type DoorScene = { x: number; z: number; yaw: number; pitch: number; layout: { gate: { x: number }; bounds: { maxZ: number } } };

async function walkIn(page: Page, words: string) {
  await page.clock.setFixedTime(NIGHT);
  await page.setViewportSize({ width: 1280, height: 720 });
  // Low detail: software WebGL on CI draws it faster.
  await pinDetail(page, "low");
  await page.goto(`/?demo=es:${words}#/today`);
  await page.getByRole("button", { name: "Walk in your garden" }).click({ timeout: 30_000 });
  await expect(page.getByText(/^\d+ plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
}

/** Stand on the mouse door's mat, facing the door, looking down at it; return where the door shows on the page (pixels). */
const onMat = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<[number, number]>((done) => {
        const s = (window as unknown as { __garden: DoorScene & { tmp: { constructor: new (x: number, y: number, z: number) => { project(c: unknown): { x: number; y: number } } }; camera: unknown } }).__garden;
        // sceneJokes.ts MOUSE_DOOR: 0.9 m left of the big door, at the hedge; its mat just in front.
        const [mx, z0] = [s.layout.gate.x - 0.9, s.layout.bounds.maxZ + 0.1];
        // Forward is -z at yaw 0: yaw π faces the hedge.
        Object.assign(s, { x: mx, z: z0 - 0.45, yaw: Math.PI, pitch: -1 });
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const v = new s.tmp.constructor(mx, 0.08, z0 - 0.02).project(s.camera);
            const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
            done([r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]);
          }),
        );
      }),
  );

test.describe.configure({ timeout: 60_000 });

test("mousedoor.shut: before the last note, a tap on the mouse door says it is locked, and on its mat no button reads a note", async ({ page }) => {
  await walkIn(page, `known:${DOOR - 1}`);
  const door = await onMat(page);
  await expect(page.getByRole("button", { name: "Read the note", exact: true })).toHaveCount(0);
  await page.mouse.click(...door);
  await expect(page.locator(".gw-say")).toHaveText("Cerrado. No es tu talla.");
});

test("mousedoor.read: with the last note, on the mat of the open mouse door, Read the note opens it", async ({ page }) => {
  await walkIn(page, `known:${DOOR}`);
  await onMat(page);
  const read = page.getByRole("button", { name: "Read the note", exact: true });
  await expect(read).toBeVisible();
  await read.click();
  const card = page.getByRole("dialog", { name: "A note from the gardener" });
  await expect(card).toContainText("Ahora el jardín es tuyo.");
});
