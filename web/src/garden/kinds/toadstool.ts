// The mushroom, on its rare days (more often in autumn): by the right side of
// a bed, both chosen by the date.

import { daily } from "../../core/day";
import { TOADSTOOL } from "../visitorArt";
import { bodyAt, type VisitorKind } from "./kind";

const ALONG = [-0.3, -0.1, 0.15, 0.35];

type Look = "toadstool";

export const toadstool: VisitorKind<Look> = {
  id: "toadstool",
  art: { toadstool: TOADSTOOL },
  arrive({ layout, now }) {
    const bed = daily(layout.beds, "visitor-toadstool-bed", now);
    const along = daily(ALONG, "visitor-toadstool-z", now);
    return { size: 0.6, body: bodyAt<Look>(bed.x + bed.w / 2 + 0.16, 0, bed.z + along * bed.d, "toadstool") };
  },
};
