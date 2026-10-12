import { expect, test } from "bun:test";
import { join } from "node:path";

test("--base without a ref says so, instead of a git error about 'undefined'", () => {
  const r = Bun.spawnSync(["bun", join(import.meta.dir, "check.ts"), "--base"], { stderr: "pipe", stdout: "pipe" });
  expect(r.exitCode).toBe(2);
  expect(r.stderr.toString()).toContain("--base needs a ref");
  expect(r.stderr.toString() + r.stdout.toString()).not.toContain("undefined");
});
