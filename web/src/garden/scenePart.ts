// The small interface the walk-in garden's scene (scene.ts, GardenScene) hosts
// its rendering subsystems behind (#323): each is a technique (the sky dome
// and clouds, the hedge's clumps, the door's mechanism, the plants' streaming,
// the critters' points and sprites, the visitors), not a part per thing in the
// garden. GardenScene builds them once, in a fixed order (they share one
// random sequence), ticks them every frame, asks them for a tap in one
// priority order, and disposes them when the walk ends.

import type { DoorAction, TimeOfDay } from "./scene";
import type { PlacedTree } from "./orchard";
import type { PlacedPlant } from "./world";
import type { SceneryHit, SceneryView } from "./scenery";
import type { VisitorView } from "./visitors";

/**
 * What setTime/setDark broadcast today: the time of day, and whether it is
 * dark enough for lanterns, fireflies and the moon (dusk or night). Weather
 * and the hour will join this later; parts read only this, never the clock.
 */
export interface Conditions {
  time: TimeOfDay;
  dark: boolean;
}

export interface Part {
  /** Animate this part: `dt` seconds since the last frame, `elapsed` seconds since the walk opened. Allocates nothing: it runs every frame. */
  tick?(dt: number, elapsed: number): void;
  /** The time of day changed. */
  onConditions?(c: Conditions): void;
  /** The best hit this part owns under this point on the canvas (CSS pixels), if any. The host picks the overall winner by TAP_PRIORITY. */
  pick?(cssX: number, cssY: number, cssW: number, cssH: number): TapHit | null;
  /** Frees this part's own geometry, materials and textures not already freed by the scene's own sweep. */
  dispose?(): void;
}

/**
 * A tap the scene can answer. The host's one dispatcher (GardenScene.pickAny)
 * asks every part and keeps the hit whose kind comes first in TAP_PRIORITY:
 * a visitor, then a plant, an orchard tree, the door or key, and last the
 * garden itself (scenery). GardenWalk.tsx has one switch on `kind` instead of
 * the five-step chain it used to run itself.
 */
export type TapHit =
  | { kind: "visitor"; v: VisitorView }
  | { kind: "plant"; p: PlacedPlant }
  | { kind: "tree"; t: PlacedTree }
  | { kind: "door"; a: DoorAction }
  | { kind: "scenery"; s: { view: SceneryView; hit: SceneryHit } };

/** The order GardenScene.pickAny checks a tap in: first match wins. */
export const TAP_PRIORITY: readonly TapHit["kind"][] = ["visitor", "plant", "tree", "door", "scenery"];
