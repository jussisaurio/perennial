// The lookout's things on the hill's top (#722, #858, lookout.ts): the old
// gardener's stool, and from note n09 on a tall flat stone beside it with the
// gardener's diary on it, a red ribbon out of it while a page is unread.
// Its lantern is one of the garden's (sceneLanterns.ts). Static meshes: the
// words are never drawn in the world.

import * as THREE from "three";
import { DIARY_REACH, hillY, STONE_R, STOOL_REACH, type Lookout } from "./lookout";
import { rayBox, type Ray } from "./scenery";
import { still, type BuildCtx } from "./sceneSprites";
import * as T from "./textures";

/** The flat stone's height, and the diary on it (m): high enough that, stood by it in reach, the book and its ribbon are in view. */
const STONE_H = 0.7;
const BOOK = { w: 0.15, h: 0.035, d: 0.2 };
/** How long the ribbon lies out of the book (m), on the stone's top: short of its edge. */
const RIBBON = 0.15;

export class LookoutThings {
  private hill: Lookout;
  /** Each page in the diary, in the order it came, and whether it is still unread. */
  private pages: { id: string; unread: boolean }[] = [];
  private ribbon: THREE.Object3D | null = null;
  private book: { min: [number, number, number]; max: [number, number, number] } | null = null;

  constructor(hill: Lookout) {
    this.hill = hill;
  }

  /** The stool, and the diary on its stone when it has `pages` (null: before n09, no diary). */
  build(c: BuildCtx, pages: readonly { id: string; unread: boolean }[] | null) {
    const h = this.hill;
    // A three-legged stool, its seat a thick round of wood, its legs splayed out to feet wider than the seat: from the path it reads as a seat, not a little gate.
    const stool = new THREE.Group();
    const wood = c.mat(c.woodTex);
    const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.19, 0.07, 10), wood);
    seat.position.y = 0.45 - 0.035;
    stool.add(seat);
    const [under, splay] = [0.45 - 0.07, 0.3];
    const legLen = under / Math.cos(splay);
    for (let i = 0; i < 3; i++) {
      // Each leg in a frame turned so its +x points out from the middle; the leg's foot leans out along it.
      const out = new THREE.Group();
      out.rotation.y = -((i / 3) * Math.PI * 2 + 0.4);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.035, legLen, 0.035), wood);
      leg.rotation.z = splay;
      leg.position.set(0.1 + (legLen / 2) * Math.sin(splay), under / 2, 0);
      out.add(leg);
      stool.add(out);
    }
    stool.position.set(h.stool[0], hillY(h, ...h.stool), h.stool[1]);
    stool.rotation.y = 0.5;
    c.scene.add(still(stool));
    if (!pages) return;

    this.pages = pages.map((p) => ({ ...p }));
    const [sx, sz] = h.stone;
    // The stone's foot sits a little into the slope, so no gap shows on its low side.
    const foot = hillY(h, sx, sz) - 0.04;
    const stone = new THREE.Mesh(new THREE.CylinderGeometry(STONE_R - 0.03, STONE_R, STONE_H, 7), c.mat(T.pixelTexture(T.stone(), true)));
    stone.position.set(sx, foot + STONE_H / 2, sz);
    const top = foot + STONE_H;
    const book = new THREE.Mesh(new THREE.BoxGeometry(BOOK.w, BOOK.h, BOOK.d), c.mat(T.pixelTexture(T.diary())));
    book.position.set(sx, top + BOOK.h / 2, sz);
    book.rotation.y = h.face + 0.3;
    // Out of the pages at the book's head (its -z, toward the far house), lying on the stone's top: from the path side you see it past the book, not under your feet.
    const ribbon = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.004, RIBBON), c.mat(T.pixelTexture(T.ribbon())));
    ribbon.position.set(0.03, -BOOK.h / 2 + 0.002, -(BOOK.d / 2 + RIBBON / 2 - 0.02));
    book.add(ribbon);
    this.ribbon = ribbon;
    const r = Math.hypot(BOOK.w, BOOK.d) / 2;
    this.book = { min: [sx - r, top, sz - r], max: [sx + r, top + BOOK.h, sz + r] };
    c.scene.add(still(stone), still(book));
    this.showRibbon();
  }

  /** The ribbon lies out of the book while a page is unread. */
  private showRibbon() {
    this.ribbon!.visible = this.unread;
  }

  /** Has the diary a page not read yet? */
  get unread(): boolean {
    return this.pages.some((p) => p.unread);
  }

  /** Is note `id` a page of the diary? */
  has(id: string): boolean {
    return this.pages.some((p) => p.id === id);
  }

  /** The page the diary opens on: the oldest not read yet, or the last when every page is read. */
  page(): string {
    const p = this.pages.find((p) => p.unread);
    return p ? p.id : this.pages[this.pages.length - 1].id;
  }

  /** Page `id` was read. */
  read(id: string) {
    const p = this.pages.find((p) => p.id === id);
    if (!p) throw new Error(`no page "${id}" in the diary`);
    p.unread = false;
    this.showRibbon();
  }

  /** Near enough (and `slack` m more) to the stool to sit on it. Runs every frame: no allocation. */
  byStool(x: number, z: number, slack: number): boolean {
    return Math.hypot(this.hill.stool[0] - x, this.hill.stool[1] - z) < STOOL_REACH + slack;
  }

  /** Near enough (and `slack` m more) to the diary's stone to read it, while there is one. Runs every frame: no allocation. */
  byDiary(x: number, z: number, slack: number): boolean {
    return this.pages.length > 0 && Math.hypot(this.hill.stone[0] - x, this.hill.stone[1] - z) < DIARY_REACH + slack;
  }

  /** How far along a ray it first meets the diary, or Infinity. */
  pick(r: Ray): number {
    return this.book ? rayBox(r, this.book.min, this.book.max) : Infinity;
  }
}
