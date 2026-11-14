// Preloaded into `bun test` by scripts/mutate.ts: it serves one mutant, the file at MUTANT_SOURCE,
// wherever the code imports MUTANT_FILE. So the file on disk never changes.
import { plugin } from "bun";

const file = process.env.MUTANT_FILE;
const source = process.env.MUTANT_SOURCE;
if (!file || !source) throw new Error("mutant-loader.ts needs MUTANT_FILE and MUTANT_SOURCE: scripts/mutate.ts sets them");
const exactly = new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

plugin({
  name: "mutant",
  setup(build) {
    build.onLoad({ filter: exactly }, async () => ({ contents: await Bun.file(source).text(), loader: "ts" }));
  },
});
