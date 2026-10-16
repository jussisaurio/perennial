// The small interface the walk-in garden's scene (scene.ts, GardenScene) hosts
// its rendering subsystems behind (#323): each is a technique (the sky dome
// and clouds, the door's mechanism, the plants' streaming, the critters'
// points and sprites), not a part per thing in the garden. GardenScene keeps
// one array of these, ticks every one with the same Frame, broadcasts
// Conditions to every one, and disposes every one in that order, documented
// in GardenScene itself. The hedge and the orchard build geometry only, with
// nothing to tick, react to conditions or dispose beyond what the scene's own
// sweep frees, so they are not Parts; visitors (sceneVisitors.ts) predate this
// interface and were not reshaped to fit it (#323's course correction).

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

/** What a Part's tick needs: nothing here is read from Date, performance.now or Math.random. */
export interface Frame {
  /** Seconds since the last frame. */
  dt: number;
  /** Seconds since the walk opened. */
  elapsed: number;
  /** The viewer's position and the way they face (world.ts's x/z metres, yaw radians). */
  x: number;
  z: number;
  yaw: number;
}

export interface Part {
  /** Animate this part by one Frame. Allocates nothing: it runs every frame. */
  tick?(f: Frame): void;
  /** The time of day changed. */
  onConditions?(c: Conditions): void;
  /** Frees this part's own geometry, materials and textures not already freed by the scene's own sweep. */
  dispose?(): void;
}

/**
 * A tap the scene can answer. The host's one dispatcher (GardenScene.pickAny)
 * asks its own pickVisitor/pick/pickTree/pickDoor/pickScenery methods (each
 * already a pure query against a part or the host's own state) and keeps the
 * hit whose kind comes first in TAP_PRIORITY: a visitor, then a plant, an
 * orchard tree, the door or key, and last the garden itself (scenery).
 * GardenWalk.tsx has one switch on `kind` instead of the five-step chain it
 * used to run itself. Picking is not part of the Part interface: no part
 * implements its own pick, so there is nothing to ask in a loop.
 */
export type TapHit =
  | { kind: "visitor"; v: VisitorView }
  | { kind: "plant"; p: PlacedPlant }
  | { kind: "tree"; t: PlacedTree }
  | { kind: "door"; a: DoorAction }
  | { kind: "scenery"; s: { view: SceneryView; hit: SceneryHit } };

/** The order GardenScene.pickAny checks a tap in: first match wins. */
export const TAP_PRIORITY: readonly TapHit["kind"][] = ["visitor", "plant", "tree", "door", "scenery"];
