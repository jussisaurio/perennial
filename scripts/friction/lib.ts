// The friction log's pure parts: the line format on issue #656, and the ranking of what is still
// open. scripts/friction.ts does the I/O, and scripts/upkeep reads the ranking each week.
import { BOT, type Comment } from "../autorun/lib.ts";

/** The friction log (docs/agents.md, "Report"). */
export const LOG_ISSUE = 656;

/** A friction area is a short tag, so that reports of one problem group: `shots`, `e2e ports`, `gh`. */
const AREA = /^[a-z0-9][a-z0-9 ./-]{0,29}$/;
const MAX_WHAT = 300;
/** More than a working day lost to one friction is a typo. */
const MAX_MINUTES = 600;

/** One line per entry, so that a comment can hold several and a person can still read it. */
const REPORT = /^friction: (.+?) \| (\d+) min \| (.+)$/;
const FIXED = /^friction fixed: (.+?) \| (.+)$/;

const area = (text: string) => {
  const a = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!AREA.test(a)) throw new Error(`area "${text}": use a short tag of letters, digits, spaces, dots, slashes or dashes, at most 30 characters, such as "shots" or "e2e ports"`);
  return a;
};

export function reportLine(rawArea: string, what: string, minutes: string): string {
  const m = Number(minutes);
  if (!Number.isInteger(m) || m < 0 || m > MAX_MINUTES) throw new Error(`minutes lost "${minutes}": a whole number from 0 to ${MAX_MINUTES}`);
  const w = what.trim().replace(/\s+/g, " ");
  if (!w) throw new Error("say what happened");
  if (w.length > MAX_WHAT) throw new Error(`what happened: at most ${MAX_WHAT} characters, so the ranking stays readable (this has ${w.length})`);
  return `friction: ${area(rawArea)} | ${m} min | ${w}`;
}

export function fixedLine(rawArea: string, by: string): string {
  const b = by.trim();
  if (!/^#\d+$/.test(b)) throw new Error(`fixed by "${by}": the PR or issue, such as "#1043"`);
  return `friction fixed: ${area(rawArea)} | ${b}`;
}

type Report = { area: string; minutes: number; what: string; at: string };
export type Open = { area: string; reports: Report[]; minutes: number; last: string };

/**
 * The open frictions, worst first: reports after the last "fixed" line of their area, grouped by
 * area and ranked by minutes lost (which grows with each report), then by number of reports.
 * Only lines by the workflow's token or the owner's account count: anyone can comment on a public
 * issue, and this text reaches the weekly retro issue that an agent works on.
 */
export function openFrictions(comments: Comment[], owner: string): Open[] {
  const byArea = new Map<string, Report[]>();
  for (const c of comments) {
    if (c.user?.login !== BOT && c.user?.login !== owner) continue;
    for (const line of c.body.split("\n").map((l) => l.trim())) {
      const fixed = FIXED.exec(line);
      if (fixed) byArea.delete(fixed[1]);
      const r = REPORT.exec(line);
      // The first report of an area starts its list.
      if (r) byArea.set(r[1], [...(byArea.get(r[1]) ?? []), { area: r[1], minutes: Number(r[2]), what: r[3], at: c.created_at }]);
    }
  }
  return [...byArea.entries()]
    .map(([a, reports]) => ({ area: a, reports, minutes: reports.reduce((sum, r) => sum + r.minutes, 0), last: reports.at(-1)!.at }))
    .sort((x, y) => y.minutes - x.minutes || y.reports.length - x.reports.length || y.last.localeCompare(x.last));
}

/** The ranking as Markdown: a table, then the latest notes of each area. Empty when nothing is open. */
export function renderTop(open: Open[], limit: number): string {
  if (!open.length) return "";
  const top = open.slice(0, limit);
  const table = [
    "| # | Area | Reports | Minutes lost | Last report |",
    "|---|---|---|---|---|",
    ...top.map((o, i) => `| ${i + 1} | ${o.area} | ${o.reports.length} | ${o.minutes} | ${o.last.slice(0, 10)} |`),
  ];
  const notes = top.map((o) => [`**${o.area}**`, ...o.reports.slice(-3).map((r) => `- ${r.at.slice(0, 10)}, ${r.minutes} min: ${r.what}`)].join("\n"));
  return [table.join("\n"), ...notes].join("\n\n");
}
