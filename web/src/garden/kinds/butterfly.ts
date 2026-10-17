// The butterfly (#209): resting on top of its word's plant (low by the stem
// when the plant droops). Now and then it lifts off, flapping, and settles
// again. It goes at night, like the garden's own. Called (#377), it lifts
// off higher and lands again. With reduced motion it rests, wings open.

import { BUTTERFLY, BUTTERFLY_CLOSED } from "../visitorArt";
import { bodyAt, type VisitorKind } from "./kind";

/** Called: its flight up and back (s), and how high it goes (m). */
const FLY_S = 1.6;
const FLY_UP = 0.4;

type Look = "open" | "closed";

export const butterfly: VisitorKind<Look> = {
  id: "butterfly",
  art: { open: BUTTERFLY, closed: BUTTERFLY_CLOSED },
  hit: [0.17, 0.22, 0.2],
  top: 0.4,
  arrive({ home, reducedMotion }) {
    if (!home) return null;
    const body = bodyAt<Look>(home.x + 0.03, home.thirsty ? home.soil + 0.12 : home.top, home.z + 0.06, "open");
    /** When it was last called (elapsed s). */
    let flown = -Infinity;
    return {
      size: 0.5,
      body,
      onCall({ elapsed }) {
        if (reducedMotion) return null;
        flown = elapsed;
        return { line: "The butterfly lifts off and lands again." };
      },
      onConditions({ night }) {
        body.visible = !night;
      },
      step({ elapsed }) {
        if (!body.visible || reducedMotion) return;
        const lift = Math.max(0, Math.sin(elapsed * 0.7));
        const { at } = body;
        // Called: up and back down, flapping, on top of its own drift.
        const fly = elapsed - flown < FLY_S ? Math.sin((Math.PI * (elapsed - flown)) / FLY_S) : 0;
        body.x = at.x + Math.sin(elapsed * 1.7) * 0.04 * lift;
        body.y = at.y + lift * 0.1 + fly * FLY_UP;
        body.frame = (lift > 0 || fly > 0) && Math.sin(elapsed * 9) > 0.3 ? "closed" : "open";
      },
    };
  },
};
