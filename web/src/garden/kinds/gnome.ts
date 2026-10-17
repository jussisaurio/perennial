// The shy gnome (#54): at a bed corner chosen by the date, never the
// front-left one, where the bed's sign is. It plays "statues" (gnomePose): it
// faces you while you look at it, and its name shows only then. Its lantern
// is lit at dusk and night, with a small glow. Called (#377), it freezes
// where it is for a while, its name hidden: only a garden gnome.
//
// On some days it hides instead (#379, hide.ts): behind a plant, under the
// bench, on the sign... Its name never shows while it hides. Found (a tap, or
// the action button near it), it pops up and falls over flat, and its tag
// says where it was.
//
// When the dog fetches its hat (#335 S2), it turns its back on you and faces
// the fence, hatless, and plays no more, until you give the hat back. When
// the dog fetches the gnome itself, it is gone from its spot for the rest of
// the visit: it lies somewhere, very stiff (sceneCarry.ts).

import { daily } from "../../core/day";
import { hideout } from "../hide";
import { GNOME_FALLEN, GNOME_PAD, GNOME_PEEK, gnomeArt } from "../visitorArt";
import { gnomePose, gnomeTag, type GnomePose } from "../visitors";
import { bodyAt, type Body, type VisitorKind } from "./kind";

/** How long it stays frozen after a call (s). */
const FREEZE_S = 6;

const CORNERS: readonly [number, number][] = [
  [1, 1],
  [1, -1],
  [-1, -1],
];

/** Found: it pops up this high (m) for `pop` s, then falls flat, bouncing once over `fall` s. */
const TUMBLE = { hop: 0.14, pop: 0.2, bounce: 0.05, fall: 0.35 } as const;

type Look = "front" | "side" | "back" | "frontLit" | "sideLit" | "backLit" | "peek" | "pad" | "fallen";

export const gnome: VisitorKind<Look> = {
  id: "gnome",
  art: {
    front: gnomeArt("front", false),
    side: gnomeArt("side", false),
    back: gnomeArt("back", false),
    frontLit: gnomeArt("front", true),
    sideLit: gnomeArt("side", true),
    backLit: gnomeArt("back", true),
    peek: GNOME_PEEK,
    pad: GNOME_PAD,
    fallen: GNOME_FALLEN,
  },
  hit: [0.36, 0.25, 0.38],
  top: 0.78,
  // Its name shows from further than most: you see it across the garden, and it hides it when you look away.
  tagRange: 7,
  // The lantern hangs 7.5 px right of the middle and 4.5 px up in its cell.
  glow: { dx: 7.5 / 32, dy: 4.5 / 32, size: 0.3 },
  arrive({ layout, spots, now, age, reducedMotion }) {
    const hide = hideout(layout, spots, age, now);
    let body: Body<Look>;
    if (hide) {
      body = bodyAt<Look>(hide.x, hide.y, hide.z, hide.look);
      body.hiding = true;
      body.hid = hide.where;
      body.tag = 0;
    } else {
      const bed = daily(layout.beds, "visitor-gnome-bed", now);
      const [sx, sz] = daily(CORNERS, "visitor-gnome-corner", now);
      body = bodyAt<Look>(bed.x + sx * (bed.w / 2 + 0.2), 0, bed.z + sz * (bed.d / 2 + 0.2), "front");
    }
    let pose: GnomePose = "front";
    /** On screen, and since when (elapsed s). */
    let seen = true;
    let since = 0;
    /** Frozen by a call until then (elapsed s). */
    let frozen = -1;
    let dark = false;
    /** When it was found and fell over (elapsed s); null while it hides, and on a day it did not. */
    let fell: number | null = null;
    /** The dog has its hat (#335 S2): it sulks, its back to you, and hides its name. */
    let hatless = false;
    /** Its lantern shows only while it stands here: hiding, it would give it away; lying, it is not where the glow goes; fetched, it is gone. */
    const show = () => {
      body.glow = dark && body.visible && !body.hiding && fell === null;
      if (body.hiding) return;
      if (fell !== null) {
        body.frame = "fallen";
        body.tag = 1;
        return;
      }
      const look = hatless ? "back" : pose;
      body.frame = body.glow ? `${look}Lit` : look;
      body.tag = hatless || frozen >= 0 ? 0 : gnomeTag(pose);
    };
    return {
      size: 0.56,
      body,
      onConditions(c) {
        dark = c.dark;
        show();
      },
      onTaken(what) {
        if (what === "hat") hatless = true;
        else body.visible = false;
        show();
      },
      onHatBack() {
        hatless = false;
        // It turns round to see who gave it back.
        pose = "front";
        show();
      },
      step({ elapsed }, inView) {
        if (body.hiding || hatless || !body.visible) return;
        if (fell !== null) {
          // Up in surprise, then flat on its back with one small bounce.
          const t = elapsed - fell;
          const y = body.at.y;
          if (reducedMotion || t > TUMBLE.pop + TUMBLE.fall) [body.frame, body.y] = ["fallen", y];
          else if (t < TUMBLE.pop) [body.frame, body.y] = ["front", y + TUMBLE.hop * Math.sin((Math.PI * t) / TUMBLE.pop)];
          else [body.frame, body.y] = ["fallen", y + TUMBLE.bounce * Math.sin((Math.PI * (t - TUMBLE.pop)) / TUMBLE.fall)];
          return;
        }
        if (frozen >= 0 && elapsed < frozen) return;
        if (frozen >= 0) {
          // It thaws as if you had just looked: no turn at once.
          [frozen, seen, since] = [-1, inView, elapsed];
          show();
        }
        if (inView !== seen) [seen, since] = [inView, elapsed];
        const t = elapsed - since;
        const next = gnomePose(pose, inView, inView ? 0 : t, inView ? t : 0);
        if (next === pose) return;
        pose = next;
        show();
      },
      onCall({ elapsed }) {
        // Hiding, it keeps still and quiet: a call must not give it away. Lying flat, it is already as still as can be.
        // Hatless, it sulks: it does not answer either.
        if (body.hiding || fell !== null || hatless) return null;
        frozen = elapsed + FREEZE_S;
        show();
        return { line: "The gnome freezes. It is only a garden gnome." };
      },
      onFind(elapsed) {
        body.hiding = false;
        fell = elapsed;
        show();
      },
      onVisit() {
        // It comes to sit with you on the bench (#362), and goes back after: it gets up, and has stopped hiding.
        body.hiding = false;
        body.hid = null;
        fell = null;
        pose = "front";
        show();
      },
    };
  },
};
