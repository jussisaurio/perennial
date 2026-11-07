import { describe, expect, test } from "bun:test";
import { NOTES } from "./notes";
import { unlockedNotes } from "./notes/read";
import { placeNotes, stileAt } from "./stile";
import { collide, layout, WALKER, type GardenPlant } from "./world";

const plant = (i: number): GardenPlant => ({ id: `w${i}`, lemma: `word${i}`, gloss: "", pos: ["noun", "verb", "adj"][i % 3], rank: i, planted: i, s: 10, r: 0.95, stage: "bloom", growth: 0.5, listen: false, write: false, forms: [] });

describe("where the notes are found (#714)", () => {
  test("there is no stile until the first stile note is unlocked by the words known", () => {
    for (const notes of Object.values(NOTES)) {
      const first = Math.min(...notes.filter((n) => n.beat === "stile").map((n) => n.unlockAt));
      expect(placeNotes(unlockedNotes(notes, first - 1), []).stile).toBeNull();
      expect(placeNotes(unlockedNotes(notes, first), []).stile).toHaveLength(1);
    }
  });

  test("a stile note lies under the step until it is read; then it hangs on the nails", () => {
    const unlocked = unlockedNotes(NOTES.es, 450);
    const stile = unlocked.filter((n) => n.beat === "stile").map((n) => n.id);
    const fresh = placeNotes(unlocked, []);
    expect(fresh.stile).toEqual(stile);
    expect(fresh.nails.map((n) => n.id)).not.toContain(stile[0]);
    const later = placeNotes(unlocked, [stile[0]]);
    expect(later.stile).toEqual(stile.slice(1));
    expect(later.nails).toContainEqual({ id: stile[0], unread: false });
    // Every note read: the stile stays, with nothing under its step.
    expect(placeNotes(unlocked, stile).stile).toEqual([]);
  });
});

describe("the stile's place (#714)", () => {
  test("its foot is open ground on the back path, in small and big gardens", () => {
    for (const l of [layout([]), layout(Array.from({ length: 70 }, (_, i) => plant(i))), layout(Array.from({ length: 600 }, (_, i) => plant(i)))]) {
      const s = stileAt(l);
      expect(s.z).toBe(l.bounds.minZ);
      const [x, z] = s.foot;
      // A walker can stand there: nothing pushes them off it.
      const p = collide(l, x, z, WALKER);
      expect(Math.hypot(p.x - x, p.z - z)).toBeLessThan(0.01);
    }
  });
});
