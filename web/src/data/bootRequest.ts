// GET /api/boot (#602), started as soon as the app's code loads (main.tsx),
// before React, Effect and the wire contract: the answer is on its way while
// they load. data/boot.ts reads it.

let started: Promise<Response> | null = null;

/** The one boot request: the first call starts it. */
export const startBoot = () => (started ??= fetch("/api/boot"));
