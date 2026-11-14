// The robot learner's arguments (#1024): read by live.ts, which checks them before the
// servers start, and by live.run.ts.

export const USAGE = `Usage: bun run live <folder> [--days N] [--seed S]

  <folder>   where the diary, the pictures and the findings go
  --days N   days of app use, 1 to 300 (default 30)
  --seed S   the learner's random choices (default 1): the same seed, the same learner`;

/** The owner's time zone: days start and end where the learner's do. */
export const LIVE_TZ = "Europe/Helsinki";

export interface Live {
  dir: string;
  days: number;
  seed: number;
}

export function parseLive(argv: string[]): Live {
  const [dir, ...rest] = argv;
  if (!dir || dir.startsWith("--")) throw new Error("first give the folder for the diary");
  const run: Live = { dir, days: 30, seed: 1 };
  for (let i = 0; i < rest.length; i += 2) {
    const [flag, value] = [rest[i], rest[i + 1]];
    const n = Number(value);
    if (!Number.isInteger(n)) throw new Error(`${flag} needs a whole number, not "${value}"`);
    if (flag === "--days") {
      // The first day is in January 2026: the server refuses answers from its future.
      if (n < 1 || n > 300) throw new Error("--days is 1 to 300");
      run.days = n;
    } else if (flag === "--seed") run.seed = n;
    else throw new Error(`unknown flag ${flag}`);
  }
  return run;
}
