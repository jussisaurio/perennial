// The small interface the walk-in garden's scene (scene.ts, GardenScene) hosts
// its rendering subsystems behind (#323): each is a technique (the sky dome
// and clouds, the door's mechanism, the plants' streaming, the critters'
// points and sprites), not a part per thing in the garden. GardenScene keeps
// one array of these, ticks every one with the same Frame, broadcasts
// Conditions to every one, and disposes every one in that order, documented
// in GardenScene itself. The hedge and the orchard build geometry only, with
// nothing to tick, react to conditions or dispose beyond what the scene's own
// sweep frees, so they are not Parts.

import type { DoorAction } from "./scene";
import type { Conditions } from "./conditions";
import type { LeaveTarget } from "./sceneLeave";
import type { Joke } from "./sceneJokes";
import type { CarryTarget } from "./sceneCarry";
import type { PlacedTree } from "./orchard";
import type { PlacedPlant } from "./world";
import type { SceneryHit, SceneryView } from "./scenery";
import type { VisitorView } from "./visitors";

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
  /** How fast the viewer walks this frame, on foot (m/s): 0 standing, sitting, or gliding to a plant (#359: only feet brush and bump). */
  speed: number;
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
 * asks its own pickVisitor/pick/pickTree/pickDoor/pickLeave/pickJoke/pickLantern/pickCarry/pickToy/pickGround/pickScenery
 * methods (each already a pure query against a part or the host's own state)
 * and keeps the hit whose kind comes first in TAP_PRIORITY: a visitor, then a
 * plant, an orchard tree, the door or key, the bowl and its things (#351),
 * a joke (#364), a lit lantern (#361), loose things and where to put or throw
 * them (#358), a dandelion clock (#360), ground to walk to, and last the
 * garden itself (scenery).
 * GardenWalk.tsx has one switch on `kind` instead of the five-step chain it
 * used to run itself. Picking is not part of the Part interface: no part
 * implements its own pick, so there is nothing to ask in a loop.
 */
export type TapHit =
  | { kind: "visitor"; v: VisitorView }
  | { kind: "plant"; p: PlacedPlant }
  | { kind: "tree"; t: PlacedTree }
  | { kind: "door"; a: DoorAction }
  // Leave it out (#351): the bowl, the basket's things, the shelf, or what came in the night.
  | { kind: "bowl"; t: LeaveTarget }
  // The deadpan scenery (#364): the mouse door, or the sundial at night, says its line.
  | { kind: "joke"; j: Joke }
  // Carry (#358): a loose thing to pick up; holding one, the cairn, the water to throw it in, or the ground in reach to put it down.
  | { kind: "carry"; t: CarryTarget }
  // A dandelion clock (#360), by its index in the walk's clocks.
  | { kind: "toy"; i: number }
  // A lantern while they are lit (#361), by spot: blow it out, or light it again.
  | { kind: "lantern"; i: number }
  // Open ground out of reach (#336): walk there. Ground in reach is still scenery, the path's word.
  | { kind: "walk"; x: number; z: number }
  | { kind: "scenery"; s: { view: SceneryView; hit: SceneryHit } };

/** The order GardenScene.pickAny checks a tap in: first match wins. */
export const TAP_PRIORITY: readonly TapHit["kind"][] = ["visitor", "plant", "tree", "door", "bowl", "joke", "lantern", "carry", "toy", "walk", "scenery"];
