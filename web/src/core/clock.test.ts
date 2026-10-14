import { expect, test } from "bun:test";
import { ActiveClock } from "./clock";

test("counts visible, recently-active time only", () => {
  const c = new ActiveClock(0, 45_000, 2_000);
  for (let t = 1000; t <= 10_000; t += 1000) c.tick(t);
  expect(c.elapsed).toBe(10_000);

  // Tab hidden for a minute: nothing counted.
  c.setVisible(false, 10_000);
  for (let t = 11_000; t <= 70_000; t += 1000) c.tick(t);
  expect(c.elapsed).toBe(10_000);
  c.setVisible(true, 70_000);
  c.tick(71_000);
  expect(c.elapsed).toBe(11_000);

  // Walked away with the tab open: stops after the idle limit.
  for (let t = 72_000; t <= 200_000; t += 1000) c.tick(t);
  expect(c.elapsed).toBe(10_000 + 45_000); // the idle window starts at the return (70s)
  c.input(201_000);
  c.tick(202_000);
  expect(c.elapsed).toBe(56_000);
});

test("a throttled timer can't credit a big jump", () => {
  const c = new ActiveClock(0, 45_000, 2_000);
  c.tick(30_000);
  expect(c.elapsed).toBe(2_000);
});

test("a paused session counts nothing until it continues", () => {
  const c = new ActiveClock(0, 45_000, 2_000);
  c.tick(1000);
  c.hold(true, 1000);
  for (let t = 2000; t <= 30_000; t += 1000) c.input(t); // reading the pause screen
  expect(c.elapsed).toBe(1000);
  c.hold(false, 30_000);
  c.tick(31_000);
  expect(c.elapsed).toBe(2000);
});
