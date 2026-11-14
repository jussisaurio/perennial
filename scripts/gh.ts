// GitHub's API through `gh`, for the scripts that read and write issues (scripts/alarm, scripts/autorun).
import { $ } from "bun";

/**
 * owner/name of the repository. Actions sets GITHUB_REPOSITORY; on a laptop gh reads it from the
 * checkout's git remote, so local agents can run the scripts as they are.
 */
export const REPO = process.env.GITHUB_REPOSITORY ?? (await $`gh repo view --json nameWithOwner --jq .nameWithOwner`.text()).trim();

export const api = async <T>(path: string) => (await $`gh api ${path}`.json()) as T;
/** Every page of a list. */
export const all = async <T>(path: string) => ((await $`gh api --paginate --slurp ${path}`.json()) as T[][]).flat();
/** A write with a JSON body. Its output is GitHub's answer, for the callers that need it. */
export const send = (method: "POST" | "PATCH", path: string, payload: object) => $`gh api -X ${method} ${path} --input - < ${new Response(JSON.stringify(payload))}`.quiet();
export const remove = (path: string) => $`gh api -X DELETE ${path}`.quiet();
