// The moth: round one lantern, chosen by the date, at dusk and night only.
// Now and then it bumps into the glass, backs off and rests. With reduced
// motion it sits on the lantern's roof, wings closed.

import { daily } from "../../core/day";
import { MOTH_CLOSED, MOTH_OPEN } from "../visitorArt";
import { bodyAt, type VisitorKind } from "./kind";

/** Its loop round the lantern (m), and the height of the middle of the lantern's glass. */
const MOTH_R = 0.24;
const GLASS_Y = 1.02;

type Look = "open" | "closed";

export const moth: VisitorKind<Look> = {
  id: "moth",
  art: { open: MOTH_OPEN, closed: MOTH_CLOSED },
  hit: [0.1, 0.3, 0.2],
  top: 0.3,
  lit: true,
  arrive({ spots, now, reducedMotion }) {
    const [cx, cz] = daily(spots.lanterns, "visitor-moth-lantern", now);
    const body = bodyAt<Look>(cx, 1.235, cz, reducedMotion ? "closed" : "open");
    /** Angle and radius on its loop, and a bump into the glass every 6 to 9 s (bump >= 0 while it lasts; n bumps so far). */
    let a = 0;
    let r = MOTH_R;
    let bump = -1;
    let next = 7;
    let n = 0;
    return {
      size: 0.36,
      body,
      onConditions({ dark }) {
        body.visible = dark;
      },
      step({ dt, elapsed }) {
        if (!body.visible || reducedMotion) return;
        let resting = false;
        if (bump < 0) {
          a += dt * 2.4;
          r += (MOTH_R - r) * Math.min(1, dt * 3);
          if (elapsed > next) bump = 0;
        } else {
          // Into the glass, 10 cm back, a short rest, then round again.
          bump += dt;
          const k = bump;
          if (k < 0.35) {
            a += dt * 1.2;
            r = MOTH_R + (0.09 - MOTH_R) * (k / 0.35);
          } else if (k < 0.55) r = 0.09 + 0.1 * ((k - 0.35) / 0.2);
          else if (k < 1.25) resting = true;
          else {
            bump = -1;
            n++;
            // A seeded hash, not Math.random: the same flight each time.
            const h = Math.sin(n * 12.9898) * 43758.5453;
            next = elapsed + 6 + 3 * (h - Math.floor(h));
          }
        }
        body.x = cx + Math.cos(a) * r;
        body.y = GLASS_Y - 0.03 + Math.sin(a * 2.3) * 0.05;
        body.z = cz + Math.sin(a) * r;
        body.frame = !resting && Math.sin(elapsed * 28) > 0 ? "open" : "closed";
      },
    };
  },
};
