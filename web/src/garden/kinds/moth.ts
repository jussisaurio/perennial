// The moth: round one lantern, chosen by the date, at dusk and night only.
// Now and then it bumps into the glass, backs off and rests. With reduced
// motion it sits on the lantern's roof, wings closed. When its lantern is
// blown out (#361) it flies to the nearest lit one, a little hurt; with none
// lit, it sits on the dark lantern's roof until one is lit again.

import { daily } from "../../core/day";
import { MOTH_CLOSED, MOTH_OPEN } from "../visitorArt";
import { LANTERN_GLASS_Y } from "../spots";
import { bodyAt, type VisitorKind } from "./kind";

/** Its loop round the lantern (m), the height of the lantern's roof, and how long a flight to another lantern takes (s). */
const MOTH_R = 0.24;
const ROOF_Y = 1.235;
const FLY_S = 1.8;

type Look = "open" | "closed";

export const moth: VisitorKind<Look> = {
  id: "moth",
  art: { open: MOTH_OPEN, closed: MOTH_CLOSED },
  hit: [0.1, 0.3, 0.2],
  top: 0.3,
  lit: true,
  arrive({ spots, now, reducedMotion }) {
    const lanterns = spots.lanterns;
    const first = daily(lanterns, "visitor-moth-lantern", now);
    /** Its lantern, by spot, and the middle of its loop. */
    let at = lanterns.indexOf(first);
    let [cx, cz] = first;
    const body = bodyAt<Look>(cx, ROOF_Y, cz, reducedMotion ? "closed" : "open");
    /** Angle and radius on its loop, and a bump into the glass every 6 to 9 s (bump >= 0 while it lasts; n bumps so far). */
    let a = 0;
    let r = MOTH_R;
    let bump = -1;
    let next = 7;
    let n = 0;
    /** On its way to another lantern from (fx, fz): 0 to 1 (1: there). Resting on a dark lantern's roof, none lit. */
    let fly = 1;
    let fx = 0;
    let fz = 0;
    let rest = false;
    const sitOnRoof = () => {
      [body.x, body.y, body.z] = [cx, ROOF_Y, cz];
      body.frame = "closed";
    };
    return {
      size: 0.36,
      body,
      onConditions({ dark }) {
        body.visible = dark;
      },
      onLanterns(on) {
        if (on[at]) {
          rest = false;
          return null;
        }
        const far = (i: number) => Math.hypot(lanterns[i][0] - lanterns[at][0], lanterns[i][1] - lanterns[at][1]);
        let to = -1;
        for (let i = 0; i < on.length; i++) if (on[i] && (to < 0 || far(i) < far(to))) to = i;
        if (to < 0) {
          rest = true;
          sitOnRoof();
          return null;
        }
        // Hurt only when its lantern went out under it, not when it was already sitting in the dark.
        const said = rest ? null : "…";
        [fx, fz, fly, rest, at] = [body.x, body.z, reducedMotion ? 1 : 0, false, to];
        [cx, cz] = lanterns[to];
        [body.at.x, body.at.z] = [cx, cz];
        // With reduced motion it is simply there, on the roof; otherwise step() flies it over.
        if (reducedMotion) sitOnRoof();
        return said;
      },
      step({ dt, elapsed }) {
        if (!body.visible || reducedMotion || rest) return;
        if (fly < 1) {
          // Over to the next lit lantern, low and wobbly: a little hurt.
          fly = Math.min(1, fly + dt / FLY_S);
          const e = fly * fly * (3 - 2 * fly);
          body.x = fx + (cx - fx) * e;
          body.y = LANTERN_GLASS_Y + Math.sin(Math.PI * fly) * 0.25 + Math.sin(elapsed * 9) * 0.05;
          body.z = fz + (cz - fz) * e;
          body.frame = Math.sin(elapsed * 22) > 0 ? "open" : "closed";
          return;
        }
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
        body.y = LANTERN_GLASS_Y - 0.03 + Math.sin(a * 2.3) * 0.05;
        body.z = cz + Math.sin(a) * r;
        body.frame = !resting && Math.sin(elapsed * 28) > 0 ? "open" : "closed";
      },
    };
  },
};
