// POST /api/demo (#784): the demo learner (?demo in the app). The app asks for a
// size; the server makes the course and its made-up review history
// (server/src/demo.ts, web/src/dev/plan.ts).

import { Schema } from "effect";
import { Lang } from "./course";

const count = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10_000 }));

/**
 * How big the demo learner is: exactly `known` words known (a story point), or
 * `studied` words studied, the most common first; with neither, every deck word.
 * `known` comes first: a Struct ignores keys it does not name, so `{ known }`
 * would also pass as the second one.
 */
export const DemoSize = Schema.Union([Schema.Struct({ known: count }), Schema.Struct({ studied: Schema.optionalKey(count) })]);
export type DemoSize = typeof DemoSize.Type;

/**
 * `now`: the app's clock (epoch ms), which the history ends at, as when the app
 * made it: a test that sets the page's clock gets a garden of that day.
 */
export const DemoIn = Schema.Struct({ lang: Lang, size: DemoSize, now: Schema.Int.check(Schema.isGreaterThan(0)) });
export type DemoIn = typeof DemoIn.Type;
