// Opt-in V8 coverage of the app across the e2e suite, for the dead-code report
// (`bun run deadcode` at the root, #812). Off unless E2E_COVERAGE=1, so normal runs
// stay fast. Each test adds its page's coverage to a cache dir that all workers share;
// e2e/coverage-report.ts merges it, mapped back to web/src through Vite's source maps.

import type { Page } from "@playwright/test";
import { CoverageReport, type CoverageReportOptions } from "monocart-coverage-reports";

export const COVERAGE = process.env.E2E_COVERAGE === "1";

export const coverageOptions: CoverageReportOptions = {
  name: "e2e",
  outputDir: "coverage/e2e",
  // Only the app's own modules: not Vite's client, nor the prebundled dependencies.
  // index.css is served as a JS module too, but has no functions of ours.
  entryFilter: (entry) => /^\/src\/.*\.tsx?$/.test(new URL(entry.url).pathname),
  // Vite's dev source maps name only the file ("shed.ts"); its dir is in the URL the
  // module came from (distFile, "localhost-5191/src/garden/shed.ts").
  // MCR also asks for the module's own path, with no distFile: that one stays as it is.
  sourcePath: (filePath, { distFile }) => {
    if (distFile === undefined) return filePath;
    const path = distFile.replace(/^[^/]+\//, "");
    if (!path.endsWith(`/${filePath}`)) throw new Error(`coverage: can't place source ${filePath} from ${distFile}`);
    return `web/${path}`;
  },
  reports: [["v8-json"]],
};

/** Adds one page's JS coverage to the shared cache. */
export async function addCoverage(entries: Awaited<ReturnType<Page["coverage"]["stopJSCoverage"]>>): Promise<void> {
  await new CoverageReport(coverageOptions).add(entries);
}
