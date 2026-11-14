// The small interface the walk-in garden's scene (scene.ts, GardenScene) hosts
// its rendering subsystems behind (#323): each is a technique (the sky dome
// and clouds, the door's mechanism, the plants' streaming, the critters'
// points and sprites), not a part per thing in the garden. GardenScene keeps
// one array of these, ticks every one with the same Frame, broadcasts
// Conditions to every one, and disposes every one in that order, documented
// in GardenScene itself. The hedge and the orchard build geometry only, with
// nothing to tick, react to conditions or dispose (the scene's lost context
// frees their GPU memory), so they are not Parts. What a tap acts on has
// its own small interface below (Tapper, #850): a thing, not a technique. What
// the action button acts on is reachCore.ts's.

import type { DoorAction } from "./reachCore";
import type { Reply } from "./kinds/kind";
import type { Conditions } from "./conditions";
import type { Joke } from "./sceneJokes";
import type { CarryTarget } from "./sceneCarry";
import type { PlacedTree } from "./orchard";
import type { PlacedPlant } from "./world";
import type { Ray, SceneryHit, SceneryView } from "./scenery";
import type { FrogWords, VisitorView } from "./visitors";

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

/** What a tap meets, by kind: each kind's own fields (TapHit). */
interface Tapped {
  visitor: { v: VisitorView };
  plant: { p: PlacedPlant };
  tree: { t: PlacedTree };
  door: { a: DoorAction };
  // The deadpan scenery (#364): the mouse door, or the sundial at night, says its line.
  joke: { j: Joke };
  // A gardener's note on its nail in the shed (#654), by id.
  note: { id: string };
  // Carry (#358): a loose thing to pick up; holding one, the well, the water to throw it in, or the ground in reach to put it down.
  carry: { t: CarryTarget };
  // A dandelion clock (#360), by its index in the walk's clocks.
  toy: { i: number };
  // A lantern while they are lit (#361), by spot: blow it out, or light it again.
  lantern: { i: number };
  // Open ground out of reach (#336): walk there. Ground in reach is still scenery, the path's word.
  walk: { x: number; z: number };
  scenery: { s: { view: SceneryView; hit: SceneryHit } };
}

/**
 * A tap the scene can answer (#323, #850): one of the kinds above. GardenScene
 * keeps one Tapper per kind and asks them in TAP_PRIORITY order: a visitor,
 * then a plant, an orchard tree, the door or key, a joke (#364), a gardener's
 * note (#654), a lit lantern (#361), loose things and where to put them
 * (#358), a dandelion clock (#360), ground to walk to, and last the garden
 * itself (scenery). The first that meets something wins.
 */
export type TapHit<K extends keyof Tapped = keyof Tapped> = { [P in K]: { kind: P } & Tapped[P] }[K];

/** The order GardenScene.pickAny checks a tap in: first match wins. */
export const TAP_PRIORITY: readonly TapHit["kind"][] = ["visitor", "plant", "tree", "door", "joke", "note", "lantern", "carry", "toy", "walk", "scenery"];

/** A tap: a point on the canvas and the canvas's size (CSS pixels), and the ray from the eye through that point. */
export interface TapAt {
  x: number;
  y: number;
  w: number;
  h: number;
  r: Ray;
}

/** One kind of thing a tap can meet (#850). */
export interface Tapper<K extends TapHit["kind"]> {
  /** What a tap there meets of this kind, or null. Pure: the scene may ask every kind. */
  pick(at: TapAt): TapHit<K> | null;
  /** Act on it: in reach at once, from farther away after a walk up to it. A visitor may answer (`frog`: what the frog may say). */
  tap(hit: TapHit<K>, frog: FrogWords): Reply | null | void;
}
