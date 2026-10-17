// The shy gnome (#54): at a bed corner chosen by the date, never the
// front-left one, where the bed's sign is. It plays "statues" (gnomePose): it
// faces you while you look at it, and its name shows only then. Its lantern
// is lit at dusk and night, with a small glow.

import { daily } from "../../core/day";
import { gnomeArt } from "../visitorArt";
import { gnomePose, gnomeTag, type GnomePose } from "../visitors";
import { bodyAt, type VisitorKind } from "./kind";

const CORNERS: readonly [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, -1],
];

type Look = "front" | "side" | "frontLit" | "sideLit";

export const gnome: VisitorKind<Look> = {
  id: "gnome",
  art: { front: gnomeArt("front", false), side: gnomeArt("side", false), frontLit: gnomeArt("front", true), sideLit: gnomeArt("side", true) },
  hit: [0.36, 0.25, 0.38],
  top: 0.78,
  // Its name shows from further than most: you see it across the garden, and it hides it when you look away.
  tagRange: 7,
  // The lantern hangs 7.5 px right of the middle and 4.5 px up in its cell.
  glow: { dx: 7.5 / 32, dy: 4.5 / 32, size: 0.3 },
  arrive({ layout, now }) {
    const bed = daily(layout.beds, "visitor-gnome-bed", now);
    const [sx, sz] = daily(CORNERS, "visitor-gnome-corner", now);
    const body = bodyAt<Look>(bed.x + sx * (bed.w / 2 + 0.2), 0, bed.z + sz * (bed.d / 2 + 0.2), "front");
    let pose: GnomePose = "front";
    /** On screen, and since when (elapsed s). */
    let seen = true;
    let since = 0;
    const show = () => {
      body.frame = body.glow ? (pose === "side" ? "sideLit" : "frontLit") : pose;
      body.tag = gnomeTag(pose);
    };
    return {
      size: 0.56,
      body,
      onConditions({ dark }) {
        body.glow = dark;
        show();
      },
      step({ elapsed }, inView) {
        if (inView !== seen) [seen, since] = [inView, elapsed];
        const t = elapsed - since;
        const next = gnomePose(pose, inView, inView ? 0 : t, inView ? t : 0);
        if (next === pose) return;
        pose = next;
        show();
      },
    };
  },
};
