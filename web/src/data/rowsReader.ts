// The learner's rows, read from the server for the store's tables (store.ts).

import { QueryClient } from "@tanstack/query-core";
import type { LearnerRows } from "perennial-contract";
import { ApiError, HttpError } from "./http";

/** Signed out: this store is being replaced, so asking again cannot help. */
export const signedOut = (e: unknown) => (e instanceof ApiError && e.body.error === "sign_in_required") || (e instanceof HttpError && e.status === 401);

/**
 * Reads the learner's rows. The tables' reads at the same moment share one
 * request, and a failed read is tried again until the rows come: the screens
 * wait for them.
 */
export function rowsReader(load: () => Promise<LearnerRows>) {
  const queryClient = new QueryClient();
  // A try that fails while the tab is hidden or offline waits, and only a mounted
  // client wakes it when the tab is shown or back online. Unmounted, it waited for
  // good and the app stayed on the loading screen (#911).
  queryClient.mount();
  return {
    read: () =>
      queryClient.fetchQuery({
        queryKey: ["rows"],
        queryFn: load,
        // A new request each time, unless one is under way (refetchAll cancels that one first).
        staleTime: 0,
        // Nothing kept once read: a cancelled read then fails (CancelledError), where it
        // would return the old response, and the full response is not held in memory.
        gcTime: 0,
        // Keep trying (paused while hidden or offline, at most 30 s apart) until the rows come.
        retry: (_count, e) => !signedOut(e),
      }),
    cancel: () => queryClient.cancelQueries(),
    unmount: () => queryClient.unmount(),
  };
}
