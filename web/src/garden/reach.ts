// One reach rule for the action button (#838). Its own module, with no imports: shake.ts uses it, and scripts/tts reads shake.ts.

/** A thing the action button shows stays in reach this much farther (m) than where it came into reach, so the button does not blink at the edge. Only that one thing: anything else comes into reach at its own reach. */
export const REACH_SLACK = 0.3;
