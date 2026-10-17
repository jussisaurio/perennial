import { expect, test } from "./test";

// #379, the gnome's hide-and-seek: on 11 October 2026 it hides behind a plant
// in the front row of a bed. Near it, the action button finds it, and a
// screen reader hears that something small is there; found, it falls over
// and its tag says where it was.

type Sprite = { v: { id: string }; body: { at: { x: number; y: number; z: number }; hiding: boolean; hid: { text: string; word: string | null } | null; frame: string } };
type HideScene = { x: number; z: number; yaw: number; pitch: number; guests: { sprites: Sprite[] } };

test("the gnome hides behind a plant: near it, the button finds it, it falls over, and its tag says where it was", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-11T12:00:00"));
  // Low quality: software WebGL on CI draws it faster.
  await page.addInitScript(() => localStorage.setItem("garden-quality", "low"));
  // A dev-only override brings the gnome today (it comes at 50 known words).
  await page.goto("/?demo=es:30&visitors=gnome#/today");
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await expect(page.getByText(/^30 plants · \d+ in bloom/)).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => "__garden" in window);
  const gnome = () =>
    page.evaluate(() => {
      const s = (window as unknown as { __garden: HideScene }).__garden;
      const { body } = s.guests.sprites.find((g) => g.v.id === "gnome")!;
      return { at: body.at, hiding: body.hiding, hid: body.hid, frame: body.frame };
    });
  const before = await gnome();
  expect(before).toMatchObject({ hiding: true, frame: "peek", hid: { text: "behind" } });
  const word = before.hid!.word!;
  const status = page.locator(".gw > [role=status]");
  const find = page.getByRole("button", { name: "Found you" });
  // From the gate, nothing gives it away.
  await expect(find).toHaveCount(0);
  await expect(page.locator(".gw-tag", { hasText: "el gnomo" })).toHaveCount(0);

  // On the path in front of its plant, facing it.
  await page.evaluate((at) => Object.assign((window as unknown as { __garden: HideScene }).__garden, { x: at.x, z: at.z + 1.2, yaw: 0, pitch: -0.3 }), before.at);
  await expect(find).toBeVisible();
  await expect(status).toHaveText(`Something small is behind ${word}.`);
  await expect(status.locator("span[lang=es]")).toHaveText(word);

  await find.click();
  await expect(status).toHaveText(`You found the gnome. It was behind ${word}.`);
  await expect(find).toHaveCount(0);
  await expect.poll(async () => (await gnome()).frame).toBe("fallen");
  expect((await gnome()).hiding).toBe(false);
  await expect(page.locator(".gw-tag", { hasText: "el gnomo" })).toHaveText(`el gnomo · behind ${word}`);
});
