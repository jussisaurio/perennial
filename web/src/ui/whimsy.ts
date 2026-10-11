// Small helpers for Perennial's quiet jokes: a line that changes each day (and
// stays put while you look at it), and rare events that most visits never see.

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The local calendar day, e.g. "2026-10-11". */
export function today(now = new Date()): string {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

/** One line from a pool: the same all day for this key, a different one tomorrow. */
export function daily<T>(pool: readonly T[], key: string, now = new Date()): T {
  return pool[hash(`${today(now)}:${key}`) % pool.length];
}

/** True on roughly one day in `oneIn` for this key (stable for the whole day). */
export function rareDay(oneIn: number, key: string, now = new Date()): boolean {
  return hash(`rare:${today(now)}:${key}`) % oneIn === 0;
}
