import { DAY_MS } from "../core/day";
import type { Refused } from "../data/store";

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Writes the server refused (#253): what was lost, and what the learner can do about it. */
export function refusedLine({ count, clock }: Pick<Refused, "count" | "clock">): string {
  const was = (n: number, one: string) => `${plural(n, one)} ${n === 1 ? "was" : "were"} not saved`;
  const other = count - clock;
  const parts = [];
  if (clock) parts.push(`${was(clock, "answer")}, because the date or time on this device is wrong. Set the correct date and time, then answer again.`);
  if (other) parts.push(`${was(other, clock ? "other change" : "change")}. The server did not accept ${other === 1 ? "it" : "them"}.`);
  return parts.join(" ");
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "in 3 days", "in 5 hours", "now" — for when something comes back. */
export function relTime(ts: number, now = Date.now()): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return "now";
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < DAY_MS) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 60 * DAY_MS) return rtf.format(Math.round(diff / DAY_MS), "day");
  return rtf.format(Math.round(diff / (30 * DAY_MS)), "month");
}
