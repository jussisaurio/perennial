export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "in 3 days", "in 5 hours", "now" — for when something comes back. */
export function relTime(ts: number, now = Date.now()): string {
  const diff = ts - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return "now";
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  if (abs < 60 * 86_400_000) return rtf.format(Math.round(diff / 86_400_000), "day");
  return rtf.format(Math.round(diff / (30 * 86_400_000)), "month");
}
