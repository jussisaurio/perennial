// Parallel agents each work in a worktree (.claude/worktrees/<name>). Its name gives the
// e2e run its own ports and database, so runs in two worktrees don't clash. The main
// checkout has no name and keeps the plain ports and database.
const name = /\/\.claude\/worktrees\/([^/]+)/.exec(process.cwd())?.[1];

/** 10–4000 in steps of 10 (each offset uses 4 consecutive ports), or 0 outside a worktree. */
function worktreeOffset(): number {
  if (name === undefined) return 0;
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 10 * (1 + (h % 400));
}

// E2E_PORT_OFFSET overrides the worktree's offset when a port is taken anyway.
export const PORT_OFFSET = Number(process.env.E2E_PORT_OFFSET ?? worktreeOffset());

// The worktree's database is made on the first run (scripts/e2e-db.ts). The main
// checkout's is server/src/config.ts's default.
const DATABASE = name === undefined ? "perennial" : `perennial_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`;
export const DATABASE_URL = `postgres://perennial:perennial@localhost:25432/${DATABASE}`;
