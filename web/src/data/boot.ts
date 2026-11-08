// What the app needs to start (GET /api/boot, #602): the session's user, their
// rows and this server's info, in one answer. Before, the app waited for the
// session, then asked for the rows: two round trips in a row, and a third for
// the server's info. The first session check (auth.ts), the store's first read
// (store.ts) and the first server info (server.ts) come from here. Later reads
// use their own endpoints. Without this answer the page says it could not
// load, with Reload (App.tsx, #911).

import { Effect } from "effect";
import { Boot } from "perennial-contract";
import { reportBadAnswer } from "../observability";
import { startBoot } from "./bootRequest";
import { NetworkError, readAnswer } from "./http";

let read: Promise<Boot> | null = null;

/**
 * The boot answer, read once. It rejects as `request` does (offline, an error
 * answer, an answer that breaks the contract), and when the answer stops
 * coming (bootRequest.ts).
 */
export const boot = (): Promise<Boot> =>
  (read ??= Effect.runPromise(
    Effect.tryPromise({ try: startBoot, catch: (cause) => new NetworkError({ cause }) }).pipe(
      Effect.flatMap((res) => readAnswer(Boot, "/api/boot", res)),
      Effect.tapError((e) => (e._tag === "BadAnswer" ? Effect.sync(() => reportBadAnswer(e.path, String(e.cause))) : Effect.void)),
    ),
  ));

let answered: Promise<boolean> | null = null;

/** Whether the boot answer came: for React's `use`, so the app waits for it and shows a failure. */
export const bootAnswered = (): Promise<boolean> =>
  (answered ??= boot().then(
    () => true,
    () => false,
  ));
