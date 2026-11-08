import { describe, expect, test } from "bun:test";
import { ANSWER_NOTE, FAR_HOUSE, hasNote, HILLTOP_R, hillMesh, hillY, lookoutAt, LookoutLight } from "./lookout";
import { NOTES } from "./notes";
import { HILLS } from "./sceneSky";
import { HILL_ROWS, hillProfile } from "./textures";
import { stileAt, TOP } from "./stile";
import { layout } from "./world";
import { LANTERN_REACH } from "./sceneLanterns";

describe("the far light's answer (#683, #858)", () => {
  test("it answers once note n12 is on the shed's nails, in every course", () => {
    for (const notes of Object.values(NOTES)) {
      const before = notes.filter((n) => n.id !== ANSWER_NOTE).map((n) => n.id);
      expect(hasNote(notes, before, ANSWER_NOTE)).toBe(false);
      expect(hasNote(notes, [...before, ANSWER_NOTE], ANSWER_NOTE)).toBe(true);
    }
  });

  test("a course without note n12 fails loudly", () => {
    expect(() => hasNote(NOTES.es.filter((n) => n.id !== ANSWER_NOTE), [], ANSWER_NOTE)).toThrow();
  });

  test("from n12 on, every second signal gets an answer a few seconds later: out, on, out, and on for good", () => {
    const light = new LookoutLight(true);
    light.signal(10);
    expect(light.answering(20)).toBe(false);
    expect([11, 13, 15].map((t) => light.on(t))).toEqual([true, true, true]);
    light.signal(30);
    // About a second dark, a second lit, a second dark, then lit for good.
    expect([32, 33.1, 34.1, 35.1, 36.1, 100].map((t) => light.on(t))).toEqual([true, false, true, false, true, true]);
    // Its line shows once, as it goes dark.
    expect(light.answering(32.9)).toBe(false);
    expect(light.answering(33.1)).toBe(true);
    expect(light.answering(33.5)).toBe(false);
    // Two more signals, another answer.
    light.signal(200);
    expect(light.on(203.1)).toBe(true);
    light.signal(210);
    expect(light.on(213.1)).toBe(false);
    expect(light.answering(213.1)).toBe(true);
  });

  test("before n12, signals leave the far light shining", () => {
    const light = new LookoutLight(false);
    for (const t of [1, 2, 3, 4]) light.signal(t);
    expect([7.1, 8.1, 9.1, 10.1].map((t) => light.on(t))).toEqual([true, true, true, true]);
    expect(light.answering(6)).toBe(false);
  });
});

describe("the lookout's things (#858)", () => {
  const hill = lookoutAt(stileAt(layout([])));
  // Sat on the stool facing the far house: forward, and to the left.
  const [fx, fz] = [-Math.sin(hill.face), -Math.cos(hill.face)];
  const rel = ([x, z]: [number, number]) => {
    const [dx, dz] = [x - hill.stool[0], z - hill.stool[1]];
    return { ahead: dx * fx + dz * fz, left: dx * fz - dz * fx };
  };

  test("sat on the stool you face the far house", () => {
    const { turn, r } = FAR_HOUSE;
    const across = Math.atan2(Math.sin(turn) * r - hill.stool[0], Math.cos(turn) * r - hill.stool[1]);
    expect(Math.abs(Math.atan2(Math.sin(across - Math.atan2(fx, fz)), Math.cos(across - Math.atan2(fx, fz))))).toBeLessThan(1e-9);
  });

  test("from the seat the post stands in reach, ahead and a little left, in a phone's view; the diary's stone a metre and a half to the right", () => {
    const post = rel(hill.post);
    expect(Math.hypot(post.ahead, post.left)).toBeLessThan(LANTERN_REACH);
    // Its glass (0.21 m wide) clear of the far house, and inside the seated view of a 412×915 phone (50° high).
    const half = Math.atan((Math.tan((50 / 2) * (Math.PI / 180)) * 412) / 915);
    const glass = Math.atan2(0.105, post.ahead);
    const off = Math.atan2(post.left, post.ahead);
    expect(off - glass).toBeGreaterThan(Math.atan2(FAR_HOUSE.w / 2, FAR_HOUSE.r));
    expect(off + glass).toBeLessThan(half);
    const stone = rel(hill.stone);
    expect(stone.ahead).toBeCloseTo(0);
    expect(stone.left).toBeCloseTo(-1.5);
    // All on the hilltop's grass, well inside its brambles.
    for (const [x, z] of [hill.stool, hill.post, hill.stone]) expect(Math.hypot(x - hill.top[0], z - hill.top[1])).toBeLessThan(HILLTOP_R - 1.5);
  });
});

describe("the far house (#683, #722)", () => {
  const { turn, r, y, h } = FAR_HOUSE;
  const house = [Math.sin(turn) * r, Math.cos(turn) * r] as const;
  const stile = stileAt(layout([]));
  const hill = lookoutAt(stile);
  /** The eye's height standing (scene.ts EYE). */
  const EYE = 1.05;

  test("it stands on the hills, not against the sky", () => {
    // The hills' texture column at this turn (repeated round the ring), and the hill top's height there.
    const col = Math.floor((((turn / (Math.PI * 2)) * HILLS.repeat) % 1) * 256);
    const top = HILLS.y + HILLS.height / 2 - (hillProfile()[col] / HILL_ROWS) * HILLS.height;
    expect(y + h).toBeLessThan(top - 0.5);
    expect(y).toBeGreaterThan(HILLS.y - HILLS.height / 2);
  });

  test("from the hill's top it is in view, a little off straight out from the fence", () => {
    const [x, z] = hill.top;
    // Straight out from the fence is −z: the bearing from there is about π.
    const across = Math.atan2(house[0] - x, house[1] - z);
    expect(Math.abs(Math.atan2(Math.sin(across - Math.PI), Math.cos(across - Math.PI)))).toBeLessThan(0.3);
  });

  test("from the stile's top board the hill hides it", () => {
    // Along the line from the eye to the house's roof, somewhere the hill rises above it.
    const eye = EYE + TOP;
    const roof = y + h;
    const dist = Math.hypot(house[0] - stile.x, house[1] - stile.z);
    let hidden = false;
    for (let d = 1; d < 25; d += 0.1) {
      const k = d / dist;
      if (hillY(hill, stile.x + (house[0] - stile.x) * k, stile.z + (house[1] - stile.z) * k) > eye + (roof - eye) * k) hidden = true;
    }
    expect(hidden).toBe(true);
  });
});

describe("the hill's ground (#861)", () => {
  const hill = lookoutAt(stileAt(layout([])));
  const { position: p, index } = hillMesh(hill);

  /** The height of the drawn triangle over (x, z), found among them all. */
  function drawn(x: number, z: number): number {
    for (let t = 0; t < index.length; t += 3) {
      const [a, b, c] = [index[t] * 3, index[t + 1] * 3, index[t + 2] * 3];
      const det = (p[b + 2] - p[c + 2]) * (p[a] - p[c]) + (p[c] - p[b]) * (p[a + 2] - p[c + 2]);
      const wa = ((p[b + 2] - p[c + 2]) * (x - p[c]) + (p[c] - p[b]) * (z - p[c + 2])) / det;
      const wb = ((p[c + 2] - p[a + 2]) * (x - p[c]) + (p[a] - p[c]) * (z - p[c + 2])) / det;
      const wc = 1 - wa - wb;
      if (wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9) return wa * p[a + 1] + wb * p[b + 1] + wc * p[c + 1];
    }
    throw new Error(`no drawn triangle over (${x}, ${z})`);
  }

  test("what stands on the hill stands on the grass as drawn, not over it", () => {
    const [tx, tz] = hill.top;
    for (let i = 0; i < 300; i++) {
      // Spread over the hill, its top and slopes, by a fixed sequence.
      const [x, z] = [tx + ((i * 0.618) % 1) * 17 - 8.5, tz + ((i * 0.377) % 1) * 17 - 8.5];
      expect(hillY(hill, x, z)).toBeCloseTo(drawn(x, z), 4);
    }
    // The stool, the post and the stone too.
    for (const [x, z] of [hill.stool, hill.post, hill.stone]) expect(hillY(hill, x, z)).toBeCloseTo(drawn(x, z), 4);
  });
});
