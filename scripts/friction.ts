// The friction log on issue #656 (docs/agents.md, "Report"). Each entry is one line in a fixed
// format, so the weekly retro (scripts/upkeep) can rank what still costs time. It needs `gh`.
//
//   bun scripts/friction.ts add "<area>" "<what happened>" "<minutes lost>"   one entry, as a comment on #656
//   bun scripts/friction.ts fixed "<area>" "#<pr or issue>"                    end the open entries of an area
//   bun scripts/friction.ts top                                                 print the open frictions, worst first
//
// The area is a short tag that groups reports of one problem: "shots", "e2e ports", "gh".
import { all, REPO, send } from "./gh.ts";
import type { Comment } from "./autorun/lib.ts";
import { fixedLine, LOG_ISSUE, openFrictions, renderTop, reportLine } from "./friction/lib.ts";

const OWNER = REPO.split("/")[0];
const post = async (body: string) => {
  await send("POST", `repos/${REPO}/issues/${LOG_ISSUE}/comments`, { body });
  console.log(`On #${LOG_ISSUE}: ${body}`);
};

const [command, ...args] = process.argv.slice(2);
if (command === "add" && args.length === 3) await post(reportLine(args[0], args[1], args[2]));
else if (command === "fixed" && args.length === 2) await post(fixedLine(args[0], args[1]));
else if (command === "top" && args.length === 0) {
  const text = renderTop(openFrictions(await all<Comment>(`repos/${REPO}/issues/${LOG_ISSUE}/comments?per_page=100`), OWNER), 10);
  console.log(text || `No open frictions on #${LOG_ISSUE}.`);
} else throw new Error('use: add "<area>" "<what happened>" "<minutes lost>" | fixed "<area>" "#<pr>" | top');
