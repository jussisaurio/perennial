import { describe, expect, test } from "bun:test";
import { DetailPicker, type Detail } from "./detail";

/** A picker on a made-up clock: the sum of the frame times fed to it. */
function picker() {
  let at = 0;
  const changes: [number, Detail][] = [];
  const reports: number[] = [];
  const p = new DetailPicker(
    (d) => changes.push([at, d]),
    (ms) => reports.push(ms),
  );
  /** Frames of `ms` each, for `seconds`. */
  const run = (ms: number, seconds: number) => {
    for (let t = 0; t < seconds * 1000; t += ms) {
      at += ms;
      p.frame(ms);
    }
  };
  return { p, changes, reports, run };
}

const FAST = 1000 / 60;

describe("the walk picks its own detail (#677)", () => {
  test("a device that keeps up stays at normal", () => {
    const { changes, reports, run } = picker();
    run(FAST, 120);
    expect(changes).toEqual([]);
    expect(reports).toEqual([]);
  });

  test("the first second is not judged", () => {
    const { changes, run } = picker();
    run(500, 1);
    run(50, 1);
    run(FAST, 60);
    expect(changes).toEqual([]);
  });

  test("slow frames at normal drop to low after a few slow seconds, not after one", () => {
    const { changes, run } = picker();
    run(FAST, 2);
    run(50, 1.5);
    expect(changes).toEqual([]);
    run(50, 1.5);
    expect(changes.map(([, d]) => d)).toEqual(["low"]);
  });

  test("one long frame among quick ones is not a slow device", () => {
    const { changes, run } = picker();
    run(FAST, 2);
    // A 700 ms task each second: a slow second on average, but most frames are quick.
    for (let i = 0; i < 20; i++) {
      run(FAST, 0.3);
      run(700, 0.7);
    }
    expect(changes).toEqual([]);
  });

  test("after a drop, a long good run steps back up; a device on the edge waits longer each time, so it never flickers", () => {
    const { changes, run } = picker();
    // Slow at normal, quick at low.
    let detail: Detail = "normal";
    for (let s = 0; s < 300; s++) {
      run(detail === "normal" ? 50 : FAST, 1);
      detail = changes.at(-1)?.[1] ?? "normal";
    }
    const ups = changes.filter(([, d]) => d === "normal").map(([at]) => at);
    const downs = changes.filter(([, d]) => d === "low").map(([at]) => at);
    expect(downs.length).toBeGreaterThanOrEqual(3);
    // Each stay at low lasts about twice the one before: 10 s, 20 s, 40 s, ... after its second to settle.
    const stays = ups.map((up, i) => up - downs[i]);
    for (let i = 1; i < stays.length; i++) expect(stays[i]).toBeGreaterThan(1.8 * stays[i - 1]);
    expect(stays[0]).toBeGreaterThanOrEqual(11_000);
  });

  test("too slow even at low: reported once, with the median frame", () => {
    const { changes, reports, run } = picker();
    run(70, 60);
    expect(changes.map(([, d]) => d)).toEqual(["low"]);
    expect(reports).toEqual([70]);
  });

  test("the time the tab was hidden, and the hitch as it comes back, are not judged", () => {
    const { p, changes, run } = picker();
    run(FAST, 5);
    p.pause();
    // The first frame back spans the whole time away.
    p.frame(60_000);
    run(50, 2);
    run(FAST, 30);
    expect(changes).toEqual([]);
  });
});
