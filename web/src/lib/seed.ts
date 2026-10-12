// Seeded randomness: the same input gives the same result on every device, so
// a word grows the same plant everywhere and a daily line is the same all day.
// Outputs are load-bearing (fsrs fuzz replays due dates from hash32), so do not
// change these functions.

/** FNV-1a: a 32-bit unsigned hash of a string; a salt gives an independent stream. */
export function hash32(str: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The same hash as a number in [0, 1). */
export function hash01(str: string, salt = 0): number {
  return hash32(str, salt) / 4294967296;
}

/** Small, fast, seedable PRNG (mulberry32): numbers in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
