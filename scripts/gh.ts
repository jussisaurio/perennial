// GitHub's API through `gh`, for the scripts that read and write issues (scripts/alarm, scripts/autorun).
import { $ } from "bun";

/**
 * owner/name of the repository. Actions sets GITHUB_REPOSITORY; on a laptop gh reads it from the
 * checkout's git remote, so local agents can run the scripts as they are.
 */
export const REPO = process.env.GITHUB_REPOSITORY ?? (await $`gh repo view --json nameWithOwner --jq .nameWithOwner`.text()).trim();

export const api = async <T>(path: string) => (await $`gh api ${path}`.json()) as T;
/**
 * A body that is not JSON, such as a job's log. Newer gh (on the Actions runners) refuses to print one with
 * terminal escape sequences unless given a flag that older gh does not know (#1028), so this fetches it with
 * gh's token. Bun drops the token on the redirect to the log's signed URL on another host.
 */
export async function text(path: string): Promise<string> {
  const token = (await $`gh auth token`.text()).trim();
  const res = await fetch(`https://api.github.com/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.text();
}
/** Every page of a list. */
export const all = async <T>(path: string) => ((await $`gh api --paginate --slurp ${path}`.json()) as T[][]).flat();
/** A write with a JSON body. Its output is GitHub's answer, for the callers that need it. */
export const send = (method: "POST" | "PATCH", path: string, payload: object) => $`gh api -X ${method} ${path} --input - < ${new Response(JSON.stringify(payload))}`.quiet();
export const remove = (path: string) => $`gh api -X DELETE ${path}`.quiet();
