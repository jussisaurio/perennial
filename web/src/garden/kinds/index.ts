// Every kind of visitor in the walk, one line each (#324). Who comes on which
// day is VISITORS (visitors.ts), shared with the 2D strip; how each one looks
// and acts in the walk is its own file here. The order is the order of their
// cells in the shared atlas.

import type { VisitorId } from "../visitors";
import { bird } from "./bird";
import { butterfly } from "./butterfly";
import { cat } from "./cat";
import { dog } from "./dog";
import { fish } from "./fish";
import { frog } from "./frog";
import { gnome } from "./gnome";
import { heron } from "./heron";
import type { VisitorKind } from "./kind";
import { moth } from "./moth";
import { snail } from "./snail";
import { toadstool } from "./toadstool";

export const KINDS: Record<VisitorId, VisitorKind> = { snail, cat, toadstool, bird, frog, gnome, heron, moth, dog, fish, butterfly };
