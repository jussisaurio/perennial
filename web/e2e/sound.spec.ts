import { expect, test } from "@playwright/test";
import { startCourse, startSession } from "./helpers";

test("sound off: nothing is spoken, speaker buttons hide, and the icon and Settings agree", async ({ page }) => {
  // Count what would be spoken instead of speaking it.
  await page.addInitScript(() => {
    const w = window as unknown as { spoken: string[] };
    w.spoken = [];
    if ("speechSynthesis" in window) speechSynthesis.speak = (u: SpeechSynthesisUtterance) => void w.spoken.push(u.text);
  });
  const spoken = () => page.evaluate(() => (window as unknown as { spoken: string[] }).spoken.length);
  await startCourse(page);
  await startSession(page);
  // A new word is read out by itself while sound is on.
  await expect.poll(spoken, { timeout: 4000 }).toBeGreaterThan(0);

  const toggle = page.getByRole("button", { name: "Mute sound" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const before = await spoken();
  await page.keyboard.press("Space"); // next card: no autoplay now
  await page.waitForTimeout(2000);
  expect(await spoken()).toBe(before);
  await expect(page.getByRole("button", { name: "Play audio" })).toHaveCount(0);

  // Settings shows the same choice in words, and can turn it back on.
  await page.getByRole("button", { name: "End session" }).click();
  await page.getByRole("button", { name: /^Done/ }).click();
  await page.getByRole("tab", { name: "Settings" }).click();
  await expect(page.getByRole("radio", { name: "Sound off" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Sound on" }).click();
  expect(await page.evaluate(() => localStorage.getItem("sound"))).toBe("on");
});
