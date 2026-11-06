// Where each plant stands in the Today strip. Placed on first use, not all at once: the strip's
// first render placed every plant (two hashes each), when it draws only the ones in view (#569).

import { hash01 } from "../lib/seed";
import type { GardenPlant } from "./plants";

export interface Placed {
  p: GardenPlant;
  x: number;
  y: number;
  scale: number;
}

export interface StripPlaces {
  /** Plant i's place, the same object on every call. */
  at(i: number): Placed;
  /** The plants with lo < x < hi, left to right in plant order. */
  between(lo: number, hi: number): Placed[];
  scale: number;
}

/**
 * Plant i stands at offset + spacing·(i + 0.5), moved by up to 0.4·spacing either way, and
 * `ground` + up to 4 px down. So the plants in a range of x come from a range of i.
 */
export function stripPlaces(plants: readonly GardenPlant[], spacing: number, offset: number, ground: number): StripPlaces {
  const scale = Math.max(0.42, Math.min(1.05, spacing / 20));
  const placed: Placed[] = [];
  const at = (i: number): Placed => {
    const p = plants[i];
    return (placed[i] ??= { p, x: offset + spacing * (i + 0.5) + (hash01(p.id, 17) - 0.5) * spacing * 0.8, y: ground + hash01(p.id, 19) * 4, scale });
  };
  const between = (lo: number, hi: number): Placed[] => {
    // A plant's x is in [offset + spacing·(i + 0.1), offset + spacing·(i + 0.9)): one more index at each end covers rounding.
    const first = Math.max(0, Math.floor((lo - offset) / spacing - 0.9) - 1);
    const last = Math.min(plants.length - 1, Math.ceil((hi - offset) / spacing - 0.1) + 1);
    const out: Placed[] = [];
    for (let i = first; i <= last; i++) {
      const l = at(i);
      if (l.x > lo && l.x < hi) out.push(l);
    }
    return out;
  };
  return { at, between, scale };
}
