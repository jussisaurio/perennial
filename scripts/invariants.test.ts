import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The guard of docs/invariants.md (#1110): each rule there, and each claim in
// docs/garden-play.md, has a check that carries its id; each check that carries
// an id names one of them; and "Checked in" names the files that hold the
// checks. So the list cannot say a rule is checked when nothing checks it.

const ROOT = join(import.meta.dir, "..");
const ID = "[a-z][a-z0-9-]*(?:\\.[a-z0-9-]+)+";
/** A list entry: "- `id`: sentence". */
const ENTRY = new RegExp(`^- \`(${ID})\`:(.*)$`, "gm");
/** What an entry says when it has no check yet, and which issue adds one. */
const UNCHECKED = /Not checked yet \(#\d+\)/;
/** The words before a test title's first colon: "a.b, c.d" in the title "a.b, c.d: ...". */
const TITLE = /\b(?:test|it|describe)(?:\.\w+)*\(\s*["'`]([^"'`\n]*?):/g;
/** A check that is not one test (a fixture, a script, the robot) says so in a comment. */
const MARK = new RegExp(`// invariant (${ID})\\b`, "g");
const IS_ID = new RegExp(`^${ID}$`);

interface Entry {
  id: string;
  unchecked: boolean;
  /** The files after "Checked in", or null when the entry does not say. */
  checkedIn: string[] | null;
}

function entries(doc: string): Entry[] {
  return [...readFileSync(join(ROOT, doc), "utf8").matchAll(ENTRY)].map(([, id, text]) => {
    const tail = text.split("Checked in ")[1];
    return { id, unchecked: UNCHECKED.test(text), checkedIn: tail === undefined ? null : [...tail.matchAll(/`([^`]+)`/g)].map((m) => m[1]) };
  });
}

/** Every id a check carries, and the files that hold those checks. */
function checks(): Map<string, Set<string>> {
  // Tracked and new files: a check written but not yet added still counts.
  const files = Bun.spawnSync(["git", "ls-files", "-co", "--exclude-standard", "--", "*.ts", "*.tsx"], { cwd: ROOT }).stdout.toString().trim().split("\n");
  const out = new Map<string, Set<string>>();
  const add = (id: string, file: string) => out.set(id, (out.get(id) ?? new Set()).add(file));
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const [, id] of text.matchAll(MARK)) add(id, file);
    if (!/\.(test|spec)\.tsx?$/.test(file)) continue;
    for (const [, head] of text.matchAll(TITLE)) {
      const ids = head.split(/,\s*/);
      // A title like "the bench: ..." names no id; only one that is all ids does.
      if (ids.every((s) => IS_ID.test(s))) for (const id of ids) add(id, file);
    }
  }
  return out;
}

const same = (a: Set<string>, b: string[]) => a.size === b.length && b.every((f) => a.has(f));

test("each invariant and garden claim has a check that carries its id, and each such check names one", () => {
  const invariants = entries("docs/invariants.md");
  // garden-play.md shows one claim twice: as the example of the format, and in its section.
  const claims = new Set(entries("docs/garden-play.md").map((e) => e.id));
  const found = checks();
  const problems: string[] = [];
  const listed = new Set<string>();
  for (const { id, unchecked, checkedIn } of invariants) {
    if (listed.has(id)) problems.push(`docs/invariants.md lists \`${id}\` twice`);
    if (claims.has(id)) problems.push(`\`${id}\` is both in docs/invariants.md and a claim in docs/garden-play.md: one id, one place`);
    listed.add(id);
    const files = found.get(id);
    if (unchecked) {
      if (files) problems.push(`docs/invariants.md says \`${id}\` is not checked yet, but ${[...files].join(", ")} checks it: say "Checked in" there instead`);
    } else if (checkedIn === null) problems.push(`docs/invariants.md: \`${id}\` says neither "Checked in" nor "Not checked yet (#issue)"`);
    else if (!files) problems.push(`docs/invariants.md lists \`${id}\`, but no check carries it: start a test title with "${id}:", or mark the check "// invariant ${id}"`);
    else if (!same(files, checkedIn)) problems.push(`docs/invariants.md: \`${id}\` is checked in ${[...files].join(", ")}, but its entry says ${checkedIn.join(", ")}`);
  }
  for (const id of claims) if (!found.has(id)) problems.push(`docs/garden-play.md claims \`${id}\`, but no test title starts with "${id}:" (garden-play.md, "The text becomes the tests")`);
  for (const [id, files] of found) if (!listed.has(id) && !claims.has(id)) problems.push(`${[...files].join(", ")}: a check carries \`${id}\`, which is in neither docs/invariants.md nor docs/garden-play.md`);
  expect(problems).toEqual([]);
});
