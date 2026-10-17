// Plants answer back (#357, #335 S4): shake a plant and its word's other
// forms fall like petals (ser → soy, eres, es…), each written on its petal.
// A word with no other forms drops one leaf. Pure: the scene asks where each
// petal is at a time since the shake, and draws it.

import { formKey } from "../content/text";
import { hash01 } from "../lib/seed";

/** At most this many petals: a big verb's 16 forms would bury the plant. */
export const MAX_PETALS = 8;

/** Seconds: the shiver; the gap between petals; a petal's fall, its rest on the soil, and its fade. */
export const SHAKE = { shiver: 0.7, gap: 0.22, fall: 1.7, rest: 1.6, fade: 0.8 } as const;

/** The forms that fall: the deck's forms that are not the word itself, each once, in the deck's order. */
export function petalForms(lemma: string, forms: readonly string[]): string[] {
  const seen = new Set([formKey(lemma)]);
  const out: string[] = [];
  for (const f of forms) {
    const k = formKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
    if (out.length === MAX_PETALS) break;
  }
  return out;
}

/** How long a shake of `n` petals lasts, in seconds: the last petal's fall, rest and fade. */
export function shakeLength(n: number): number {
  return (Math.max(1, n) - 1) * SHAKE.gap + SHAKE.fall + SHAKE.rest + SHAKE.fade;
}

/** The shiver's angle (radians) at `t` seconds after the shake: quick, side to side, dying away. */
export function shiver(t: number): number {
  if (t < 0 || t > SHAKE.shiver) return 0;
  return 0.16 * (1 - t / SHAKE.shiver) * Math.sin(t * 46);
}

/**
 * Where petal `i` is at `t` seconds after the shake, from the plant's top
 * (metres: across, down, toward or away), and how much of it shows (0 to 1);
 * null before it falls or once it has faded. Each petal drifts its own way
 * (seeded by the word and its place), swaying as it falls `drop` metres to the
 * soil. With `still` (reduced motion) it lies on the soil from the start.
 */
export function petalAt(seed: string, i: number, t: number, drop: number, still: boolean): { dx: number; dy: number; dz: number; alpha: number } | null {
  const s = t - i * SHAKE.gap;
  if (s < 0 || s > SHAKE.fall + SHAKE.rest + SHAKE.fade) return null;
  const a = hash01(seed, i * 2 + 1) * Math.PI * 2;
  const r = 0.18 + hash01(seed, i * 2 + 2) * 0.32;
  const k = still ? 1 : Math.min(1, s / SHAKE.fall);
  // Eased: a petal drifts out fast, then floats down; the sway fades as it lands.
  const out = r * (1 - (1 - k) * (1 - k));
  const sway = still ? 0 : Math.sin(s * 5 + a) * 0.08 * (1 - k);
  const alpha = s < SHAKE.fall + SHAKE.rest ? 1 : 1 - (s - SHAKE.fall - SHAKE.rest) / SHAKE.fade;
  return { dx: Math.cos(a) * out + sway, dy: -drop * k, dz: Math.sin(a) * out, alpha };
}

/** Near enough to a plant (m) to shake it, if it is ahead of you: a front-row plant from where Next plant stands (world.ts viewpoint). */
export const SHAKE_REACH = 2.2;

/**
 * The plant you can shake from (x, z) facing `yaw`: of the plants in reach and
 * ahead of you (within 60° of where you look), the one nearest the middle of
 * the view, the nearer one when two are as near it; or null.
 */
export function plantInReach<P extends { x: number; z: number }>(plants: readonly P[], x: number, z: number, yaw: number): P | null {
  // Forward is -z at yaw 0.
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let best: P | null = null;
  let bestScore = Infinity;
  for (const p of plants) {
    const dx = p.x - x;
    const dz = p.z - z;
    const d = Math.hypot(dx, dz);
    const ahead = dx * fx + dz * fz;
    if (d > SHAKE_REACH || ahead < d * 0.5) continue;
    // How far it is from the line you look along, and a little for how far away.
    const score = Math.abs(dx * fz - dz * fx) + d * 0.1;
    if (score < bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}
