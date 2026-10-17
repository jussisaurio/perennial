import { expect, type Locator, type Page } from "@playwright/test";

export const newEmail = (prefix = "learner") => `${prefix}-${Math.random().toString(36).slice(2, 8)}@example.com`;

/** Rows the server has for the signed-in learner (dev-only endpoint). */
export async function serverRows<T = Record<string, unknown>>(page: Page, table: string): Promise<T[]> {
  return page.evaluate(async (table) => (await fetch(`/api/dev/rows?table=${table}`)).json(), table);
}

/** Wait until the server has `n` rows in `table` (writes upload in the background). */
export async function expectServerRows(page: Page, table: string, n: number | ((count: number) => boolean)) {
  const ok = typeof n === "number" ? (c: number) => c === n : n;
  await expect.poll(async () => ok((await serverRows(page, table)).length), { timeout: 15_000, message: `${table} rows` }).toBe(true);
}

/**
 * Wait until a write the test just made is in the app's own data (#343), not
 * on a timer: a reload right after `postWrite` can race the write landing in
 * the client's store, and under load the race is lost more often.
 */
export async function waitForSynced(page: Page, table: string, ids: string[]) {
  await page.waitForFunction(
    ({ table, ids }: { table: string; ids: string[] }) => {
      const store = (window as unknown as { __store?: { collections: Record<string, { has(k: string): boolean }> } }).__store;
      return !!store && ids.every((id) => store.collections[table].has(id));
    },
    { table, ids },
    { timeout: 20_000 },
  );
}

/** Enter an email, read the code from the dev server's outbox, sign in. */
export async function signIn(page: Page, address: string, cta: string) {
  await page.getByLabel("Email").fill(address);
  await page.locator("form").getByRole("button", { name: cta }).click();
  await expect(page.getByText("We sent a 6-digit code")).toBeVisible();
  const { code } = await (await page.request.get(`/api/dev/outbox?email=${encodeURIComponent(address)}`)).json();
  await page.getByLabel("Code", { exact: true }).fill(code);
  // The form's button, not the Sign in button in the landing page header.
  await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
}

/** First run: the landing page, then "Start learning", as an anonymous learner. */
export async function startCourse(page: Page, language: "Spanish" | "German" = "Spanish") {
  await page.goto("/");
  if (language !== "Spanish") await page.getByRole("radio", { name: new RegExp(language) }).check();
  await page.getByRole("button", { name: `Start learning ${language}` }).click();
  await expect(page.getByText(/seeds are ready/)).toBeVisible({ timeout: 15_000 });
}

/** Add an email to the anonymous learner from Settings. */
export async function addEmail(page: Page, address = newEmail()) {
  await page.getByRole("tab", { name: "Settings" }).click();
  // The app reloads once the user changes (anonymous → account).
  const reloaded = page.waitForEvent("load");
  await signIn(page, address, "Send me a code");
  await reloaded;
  await expect(page.getByText(address)).toBeVisible();
  return address;
}

export async function openAdd(page: Page) {
  await page.getByRole("tab", { name: "Words" }).click();
  await page.getByRole("button", { name: "Add words" }).click();
}

export async function startSession(page: Page) {
  await page.getByRole("button", { name: /today's 5 minutes/i }).click();
  await expect(page.locator(".kicker")).toBeVisible();
}

export const kicker = (page: Page) => page.locator(".kicker");

/** Press a key and wait until the session has moved on to another card. */
export async function advance(page: Page, key: string) {
  const root = page.locator(".session");
  const before = await root.getAttribute("data-card");
  await page.keyboard.press(key);
  await expect(root).not.toHaveAttribute("data-card", before!);
}

/** Press Tab until `target` has focus, as a keyboard user reaches a button. */
export async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 20 && !(await target.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
}

/** Reveal the answer and wait until the double-click guard lets an answer through. */
export async function reveal(page: Page) {
  const card = page.locator("main.card");
  await expect(card).toBeVisible();
  // A card starts listening for keys just after it appears, so a Space pressed
  // in that moment (or while the session is still preparing, after a page
  // load) is not heard: press again until it shows. A second Space does
  // nothing once the answer is showing.
  await expect(async () => {
    await page.keyboard.press("Space");
    await expect(card).toHaveAttribute("data-armed", "true", { timeout: 1000 });
  }).toPass();
}

/** Answer any card: show its answer or meaning, wait past the double-click guard, then press `key` (1 = left, 2 = right). */
export async function answer(page: Page, key: "1" | "2") {
  await reveal(page);
  await advance(page, key);
}

/**
 * Wait until the garden strip stops growing (the demo learner's words sync in
 * over a moment) and is wider than `min` pixels. Returns the strip's width.
 */
export async function settledGardenWidth(page: Page, min = 2000) {
  const strip = page.locator(".garden-scroll");
  const width = () => strip.evaluate((el) => el.scrollWidth);
  let last = -1;
  await expect
    .poll(
      async () => {
        const w = await width();
        const settled = w === last && w > min;
        last = w;
        return settled;
      },
      { timeout: 30_000, intervals: [500] },
    )
    .toBe(true);
  return last;
}

/** A point on the strip's plant nearest the middle, a little above its foot (between two plants there is a small gap). */
export async function plantNearMiddle(page: Page) {
  const box = (await page.locator(".garden-scroll").boundingBox())!;
  return page.locator(".garden svg > g[transform] rect").evaluateAll((els, mid) => {
    const r = els.map((e) => e.getBoundingClientRect()).sort((a, b) => Math.abs(a.x + a.width / 2 - mid) - Math.abs(b.x + b.width / 2 - mid))[0];
    return [r.x + r.width / 2, r.bottom - 20] as const;
  }, box.x + box.width / 2);
}

// The door in the hedge (#315), through the dev-only scene handle (window.__garden).
type DoorScene = {
  camera: unknown;
  tmp: { constructor: new (x: number, y: number, z: number) => { project(c: unknown): { x: number; y: number } } };
  layout: { gate: { x: number }; bounds: { maxZ: number } };
  door: { state: string; key: { x: number; z: number; mesh: { visible: boolean } } | null; leaf: { rotation: { y: number } } };
  sceneryWorld(): unknown;
};

/** Stand 2 m in front of the door, facing it, and return where the door shows on the page (pixels), level, clear of the hint at the top. */
export function standAtDoor(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __garden: DoorScene }).__garden;
    const gx = s.layout.gate.x;
    const maxZ = s.layout.bounds.maxZ;
    Object.assign(s, { x: gx, z: maxZ - 2, yaw: Math.PI, pitch: 0 });
    return new Promise<[number, number]>((done) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const v = new s.tmp.constructor(gx - 0.2, 1, maxZ + 0.1).project(s.camera);
          const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
          done([r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]);
        }),
      ),
    );
  });
}

/**
 * Stand by the hidden key (it hides in a different place for each learner), on
 * open ground `metres` from it with nothing between, looking at it; return
 * where it shows on the page (pixels).
 */
export function standByKey(page: Page, metres = 1.4) {
  return page.evaluate(async (metres) => {
    const { collide } = await import(/* @vite-ignore */ "/src/garden/world.ts");
    const { thingAt } = await import(/* @vite-ignore */ "/src/garden/scenery.ts");
    const s = (window as unknown as { __garden: DoorScene }).__garden;
    const k = s.door.key!;
    const eye = 1.05;
    // In reach a tap meets the key whatever stands in front of it; from farther, nothing may.
    const { KEY_REACH } = await import(/* @vite-ignore */ "/src/garden/sceneDoor.ts");
    // Free ground: where a walker may stand, all the way to the key, and nothing in the garden in front of it.
    const free = (x: number, z: number) => {
      const p = collide(s.layout, x, z);
      return Math.hypot(p.x - x, p.z - z) < 1e-9;
    };
    const seen = (a: number) => {
      const [x, z] = [k.x + Math.sin(a) * metres, k.z + Math.cos(a) * metres];
      const len = Math.hypot(metres, eye - 0.03);
      const ray = { ox: x, oy: eye, oz: z, dx: (k.x - x) / len, dy: (0.03 - eye) / len, dz: (k.z - z) / len };
      return thingAt(ray, s.sceneryWorld()) >= len;
    };
    const steps = Array.from({ length: Math.round((metres - 0.5) / 0.25) + 1 }, (_, i) => 0.5 + i * 0.25).concat(metres);
    const way = Array.from({ length: 16 }, (_, i) => (i / 16) * Math.PI * 2).find((a) => steps.every((d) => free(k.x + Math.sin(a) * d, k.z + Math.cos(a) * d)) && (metres <= KEY_REACH || seen(a)));
    if (way === undefined) throw new Error(`no open ground ${metres} m from the key`);
    // Forward is -z at yaw 0: face back along the way, toward the key, looking down at it.
    Object.assign(s, { x: k.x + Math.sin(way) * metres, z: k.z + Math.cos(way) * metres, yaw: way, pitch: -Math.atan2(eye - 0.03, metres) });
    return new Promise<[number, number]>((done) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const v = new s.tmp.constructor(k.x, 0.03, k.z).project(s.camera);
          const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
          done([r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]);
        }),
      ),
    );
  }, metres);
}

/** The door as plain data: its state, whether the key lies on the ground (null: none was brought) and how far it is from the door (m), and how far open the door is (radians). */
export function doorNow(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __garden: DoorScene }).__garden;
    const d = s.door;
    return {
      state: d.state,
      key: d.key && d.key.mesh.visible,
      keyFromDoor: d.key && Math.hypot(d.key.x - s.layout.gate.x, d.key.z - s.layout.bounds.maxZ),
      angle: d.leaf.rotation.y,
    };
  });
}

// Tap to walk (#336), through the dev-only scene handle (window.__garden).
export type WalkScene = {
  x: number;
  z: number;
  yaw: number;
  trip: unknown;
  camera: unknown;
  tmp: { constructor: new (x: number, y: number, z: number) => { project(c: unknown): { x: number; y: number } } };
  layout: { beds: { x: number; z: number; w: number; d: number }[]; plants: { id: string; lemma: string; x: number; z: number; bed: number }[] };
  pickAny(x: number, y: number, w: number, h: number): { kind: string; p?: { id: string } } | null;
};

/** Where the walker stands and which way they face, and whether a walk is under way. */
export const walker = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __garden: WalkScene }).__garden;
    return { x: s.x, z: s.z, yaw: s.yaw, walking: !!s.trip };
  });

/**
 * Stand in front of the first bed, a little left, and face `off` radians left
 * of a spot 3 m away on the path in front of it, to the right. Returns where
 * the spot shows on the page (pixels), the spot, and what a tap there meets.
 */
export function aimAtGround(page: Page, off: number) {
  return page.evaluate(
    (off) =>
      new Promise<{ x: number; y: number; to: { x: number; z: number }; kind: string | undefined; yaw: number }>((done) => {
        const s = (window as unknown as { __garden: WalkScene }).__garden;
        const bed = s.layout.beds[0];
        const to = { x: bed.x + 1.2, z: bed.z + bed.d / 2 + 0.9 };
        const from = { x: bed.x - 1, z: bed.z + bed.d / 2 + 3 };
        // Forward is -z at yaw 0.
        const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z)) + off;
        Object.assign(s, { ...from, yaw, pitch: -0.35 });
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const v = new s.tmp.constructor(to.x, 0, to.z).project(s.camera);
            const r = document.querySelector(".gw-canvas")!.getBoundingClientRect();
            const [x, y] = [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height];
            done({ x: r.left + x, y: r.top + y, to, kind: s.pickAny(x, y, r.width, r.height)?.kind, yaw });
          }),
        );
      }),
    off,
  );
}

/** Wait until a walk has reached `to` and stopped there. */
export async function arrives(page: Page, to: { x: number; z: number }) {
  await expect
    .poll(
      async () => {
        const w = await walker(page);
        return !w.walking && Math.hypot(w.x - to.x, w.z - to.z) < 0.05;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
}

// Leave it out (#351), through the dev-only scene handle (window.__garden).
type LeaveThing = "basket" | "bowl" | "shelf" | "find";

/** Where a thing of leave it out (#351) is: x, z, and a height to look at. */
const leavePlace = (page: Page, what: LeaveThing) =>
  page.evaluate(async (what) => {
    const { basketAt, bowlAt, shedAt } = await import(/* @vite-ignore */ "/src/garden/leave.ts");
    const s = (window as unknown as { __garden: { layout: Parameters<typeof bowlAt>[0]; leaveIt: { findSpot(): { x: number; z: number } } } }).__garden;
    const L = s.layout;
    if (what === "basket") return { ...basketAt(L), y: 0.25 };
    if (what === "bowl") return { ...bowlAt(L), y: 0.05 };
    if (what === "shelf") return { x: shedAt(L).x, z: shedAt(L).z, y: 1.2 };
    return { ...s.leaveIt.findSpot()!, y: 0.05 };
  }, what);

/** Stand `metres` from a thing, on the garden side, facing it; return where it shows on the page (pixels). */
export async function standByLeave(page: Page, what: LeaveThing, metres: number) {
  return standBy(page, await leavePlace(page, what), metres);
}

/** Stand `metres` from a point (x, z, and a height to look at), on the garden side, facing it; return where it shows on the page (pixels). */
export function standBy(page: Page, p: { x: number; y: number; z: number }, metres: number) {
  return page.evaluate(
    ({ p, metres }) => {
      const s = (window as unknown as { __garden: WalkScene }).__garden;
      // From the middle of the garden's gate side, toward the thing: open path, nothing between.
      const [fx, fz] = [0, p.z - 1.5];
      const d = Math.hypot(p.x - fx, p.z - fz);
      const [x, z] = [p.x - ((p.x - fx) / d) * metres, p.z - ((p.z - fz) / d) * metres];
      // Forward is -z at yaw 0.
      Object.assign(s, { x, z, yaw: Math.atan2(-(p.x - x), -(p.z - z)), pitch: -Math.atan2(1.05 - p.y, metres) });
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
}
