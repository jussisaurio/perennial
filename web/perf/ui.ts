// UI performance run: a production build, a demo learner with every deck word
// studied, and Chrome measuring the heaviest screens with the CPU slowed 4×
// (roughly a mid-range phone). Needs the local stack (`docker compose up -d`).
//
//   bun perf/ui.ts [--cpu 4]
//
// Writes to perf/out/: report.md (per screen: long tasks, frame times, JS heap,
// DOM size) and one CPU profile per screen (.cpuprofile: open in Chrome
// DevTools → Performance, or speedscope.app).

import { chromium, type CDPSession, type Page } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const i = process.argv.indexOf("--cpu");
const CPU = i > 0 ? Number(process.argv[i + 1]) : 4;
const WEB = join(import.meta.dir, "..");
const OUT = join(import.meta.dir, "out");
const PORT = 19900 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ---- production build with the demo switch, served by the real server -------

const build = Bun.spawnSync(["bunx", "vite", "build", "--outDir", "perf/out/dist", "--emptyOutDir", "--sourcemap"], { cwd: WEB, env: { ...process.env, VITE_DEV_TOOLS: "1" }, stdout: "ignore", stderr: "inherit" });
if (build.exitCode !== 0) throw new Error("build failed");
const server = Bun.spawn(["bun", "index.ts"], {
  cwd: join(WEB, "../server"),
  env: { ...process.env, PORT: String(PORT), APP_URL: BASE, PERENNIAL_DEV: "1", PERENNIAL_STATIC: join(OUT, "dist"), LOG_LEVEL: "silent" },
  stdout: "ignore",
  stderr: "inherit",
});
for (let n = 0; !(await fetch(`${BASE}/health`).then((r) => r.ok, () => false)); n++) {
  if (n > 100) throw new Error("server did not start");
  await Bun.sleep(100);
}

// ---- measuring --------------------------------------------------------------------

// Long tasks (> 50 ms on the main thread) and frame times, collected in the page.
const PROBE = () => {
  const w = window as unknown as { __perf: { long: number[]; frames: number[] } };
  w.__perf = { long: [], frames: [] };
  new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__perf.long.push(e.duration))).observe({ type: "longtask", buffered: true });
  let last = performance.now();
  const tick = (t: number) => {
    w.__perf.frames.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

interface Result {
  screen: string;
  ms: number;
  longTasks: number;
  longest: number;
  blocked: number;
  p95Frame: number;
  jank: number;
  heapMb: number;
  nodes: number;
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};

async function measure(page: Page, cdp: CDPSession, screen: string, action: () => Promise<void>): Promise<Result> {
  await page.evaluate(() => {
    const w = window as unknown as { __perf: { long: number[]; frames: number[] } };
    w.__perf.long = [];
    w.__perf.frames = [];
  });
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("Profiler.start");
  const t = performance.now();
  await action();
  const ms = performance.now() - t;
  const { profile } = await cdp.send("Profiler.stop");
  writeFileSync(join(OUT, `${screen.replace(/\W+/g, "-")}.cpuprofile`), JSON.stringify(profile));
  const { long, frames } = await page.evaluate(() => (window as unknown as { __perf: { long: number[]; frames: number[] } }).__perf);
  const { metrics } = await cdp.send("Performance.getMetrics");
  const metric = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
  return {
    screen,
    ms: Math.round(ms),
    longTasks: long.length,
    longest: Math.round(Math.max(0, ...long)),
    blocked: Math.round(long.reduce((a, d) => a + d - 50, 0)),
    p95Frame: Math.round(pct(frames, 95)),
    jank: frames.filter((f) => f > 50).length,
    heapMb: Math.round(metric("JSHeapUsedSize") / 1e6),
    nodes: metric("Nodes"),
  };
}

const browser = await chromium.launch({ args: ["--mute-audio", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(60_000);
await page.addInitScript(PROBE);
await page.addInitScript(() => localStorage.setItem("garden-quality", "normal"));
const cdp = await page.context().newCDPSession(page);
await cdp.send("Performance.enable");
await cdp.send("Profiler.enable");
await cdp.send("HeapProfiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 500 });

// Seed the demo learner at full speed; measure with the CPU slowed.
await page.goto(`${BASE}/?demo=es#/today`);
await page.getByRole("button", { name: /today's session/ }).waitFor({ timeout: 60_000 });
await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

const results: Result[] = [];
const scroll = async () => {
  for (let n = 0; n < 15; n++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(100);
  }
};

results.push(await measure(page, cdp, "Today: cold load", async () => {
  await page.goto(`${BASE}/#/today`);
  await page.getByRole("button", { name: /today's session/ }).waitFor();
  await page.waitForTimeout(1000);
}));
results.push(await measure(page, cdp, "Garden: open and scroll", async () => {
  await page.goto(`${BASE}/#/garden`);
  await page.waitForTimeout(1500);
  await scroll();
}));
results.push(await measure(page, cdp, "Words: open and scroll", async () => {
  await page.goto(`${BASE}/#/words`);
  await page.waitForTimeout(1500);
  await scroll();
}));
results.push(await measure(page, cdp, "Session: 10 cards", async () => {
  await page.goto(`${BASE}/#/today`);
  await page.getByRole("button", { name: /today's session/ }).click();
  await page.locator(".kicker").waitFor();
  for (let n = 0; n < 10; n++) {
    await page.keyboard.press("Space");
    await page.waitForTimeout(500);
    await page.keyboard.press("Space");
    await page.waitForTimeout(500);
  }
}));
results.push(await measure(page, cdp, "3D walk: open and walk", async () => {
  await page.goto(`${BASE}/#/today`);
  await page.getByRole("button", { name: "Walk in your garden" }).click();
  await page.locator("canvas").waitFor();
  await page.keyboard.down("w");
  await page.waitForTimeout(3000);
  await page.keyboard.up("w");
}));

await browser.close();
server.kill();

const report = `# UI performance (production build, CPU ${CPU}× slower, every Spanish deck word studied)

| Screen | Took ms | Long tasks | Longest ms | Blocked ms | p95 frame ms | Frames > 50 ms | JS heap MB | DOM nodes |
|---|---|---|---|---|---|---|---|---|
${results.map((r) => `| ${r.screen} | ${r.ms} | ${r.longTasks} | ${r.longest} | ${r.blocked} | ${r.p95Frame} | ${r.jank} | ${r.heapMb} | ${r.nodes} |`).join("\n")}

Blocked ms: main-thread time beyond 50 ms per long task (what makes input feel stuck).
The 3D walk runs on software WebGL here, so its frame times are worse than on a real GPU.
CPU profiles per screen: perf/out/*.cpuprofile (Chrome DevTools → Performance, or speedscope.app).
`;
writeFileSync(join(OUT, "report.md"), report);
console.log(report);
