// UI performance run: a production build, a demo learner with every deck word
// studied, and Chrome measuring the heaviest screens with the CPU slowed 10×.
// Needs the local stack (`docker compose up -d`). How to read the report: docs/performance.md.
//
//   bun perf/ui.ts [--cpu 10] [--runs 3] [--only Tab] [--reduced-motion] [--no-minify] [--react-profiling]
//
// The bar: no main-thread task over BUDGET_MS. A longer task is input that waits.
//
// Writes to perf/out/: report.md, and per screen the Chrome trace and CPU profile
// of its worst run (open both in Chrome DevTools → Performance).

import * as Trace from "@paulirish/trace_engine";
import { polyfillDOMRect } from "@paulirish/trace_engine/analyze-trace.mjs";
import { chromium, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "vite";

const arg = (flag: string) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined);
const CPU = Number(arg("--cpu") ?? 10);
// RAIL's frame budget: of 16.7 ms per frame, about 10 ms are ours (web.dev/articles/rail).
const BUDGET_MS = 10;
// --only <text>: just the scenarios whose name has this text. --runs <n>: medians and p90 of n runs.
const ONLY = arg("--only");
const RUNS = Number(arg("--runs") ?? 1);
// --reduced-motion: compare with animations off (the app honours the setting).
const REDUCED = process.argv.includes("--reduced-motion");
// --no-minify: readable function names in the profiles, to see where the time goes.
const MINIFY = !process.argv.includes("--no-minify");
// --react-profiling: React's profiling build, so the traces show its Scheduler track (updates, renders, commits).
const REACT_PROFILING = process.argv.includes("--react-profiling");
const WEB = join(import.meta.dir, "..");
const OUT = join(import.meta.dir, "out");
const PORT = 19900 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;

// The machine we build for is a 2011 budget laptop. On Geekbench 6 single-core an
// Apple M4 scores about 10× a Sandy Bridge i3 and about 30× an AMD E-450.
// Throttling slows only the main thread, not the GPU.
const THROTTLE = `CPU ${CPU}× slower (on an M4, 10× is about a 2011 Sandy Bridge i3 and 30× an AMD E-450 on Geekbench 6 single-core; try --cpu 25 for the slowest laptops)`;
console.log(THROTTLE);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ---- production build with the demo switch, served by the real server -------

// The server's environment, before Vite's build sets NODE_ENV=production in this process.
const SERVER_ENV = { ...process.env };
process.env.VITE_DEV_TOOLS = "1";
// Sentry on, as in prod, so its cost is measured. A .invalid host never resolves (RFC 2606): no event goes anywhere.
process.env.VITE_SENTRY_DSN = "https://key@sentry.invalid/1";
await build({
  root: WEB,
  logLevel: "warn",
  build: { outDir: join(OUT, "dist"), emptyOutDir: true, sourcemap: true, minify: MINIFY },
  // React's documented way to profile a production build (react.dev/reference/dev-tools/react-performance-tracks).
  resolve: REACT_PROFILING ? { alias: [{ find: /^react-dom\/client$/, replacement: "react-dom/profiling" }] } : {},
});
const server = Bun.spawn(["bun", "index.ts"], {
  cwd: join(WEB, "../server"),
  env: { ...SERVER_ENV, PORT: String(PORT), APP_URL: BASE, PERENNIAL_DEV: "1", PERENNIAL_STATIC: join(OUT, "dist"), LOG_LEVEL: "silent" },
  stdout: "ignore",
  stderr: "inherit",
});
for (let n = 0; !(await fetch(`${BASE}/health`).then((r) => r.ok, () => false)); n++) {
  if (n > 100) throw new Error("server did not start");
  await Bun.sleep(100);
}

// ---- measuring --------------------------------------------------------------------

interface Loaf { duration: number; blocking: number; scripts: { ms: number; invoker: string; fn: string; url: string; char: number }[] }
/** One Event Timing entry; an interaction (a click: pointerdown, pointerup, click) has several. */
interface EventEntry { name: string; id: number; start: number; processingStart: number; processingEnd: number; end: number }
interface Interaction { name: string; delay: number; processing: number; presentation: number; duration: number }
interface Probe { loafs: Loaf[]; events: EventEntry[] }

// In the page: Long Animation Frames (what blocked a frame, by script) and Event Timing
// (how long each interaction took to paint), as in the field. No script of ours runs per
// frame: DevTools commands run inside whatever JS is on the stack, and a requestAnimationFrame
// loop here was charged with them (#450). Frame times come from the trace.
const PROBE = () => {
  const w = window as unknown as { __perf: Probe };
  w.__perf = { loafs: [], events: [] };
  type Script = { duration: number; invoker: string; sourceFunctionName: string; sourceURL: string; sourceCharPosition: number };
  type LoafEntry = PerformanceEntry & { blockingDuration: number; scripts: Script[] };
  new PerformanceObserver((l) => {
    for (const e of l.getEntries() as LoafEntry[]) {
      // An invoker can quote a whole data: URL (an image's onload), so it is cut short.
      const scripts = e.scripts.map((s) => ({ ms: s.duration, invoker: s.invoker.slice(0, 60), fn: s.sourceFunctionName, url: s.sourceURL, char: s.sourceCharPosition }));
      w.__perf.loafs.push({ duration: e.duration, blocking: e.blockingDuration, scripts });
    }
  }).observe({ type: "long-animation-frame", buffered: true });
  type EventTiming = PerformanceEntry & { interactionId: number; processingStart: number; processingEnd: number };
  new PerformanceObserver((l) => {
    for (const e of l.getEntries() as EventTiming[]) {
      // Only discrete interactions (clicks, taps, key presses) count for INP; scrolling does not.
      if (!e.interactionId) continue;
      w.__perf.events.push({ name: e.name, id: e.interactionId, start: e.startTime, processingStart: e.processingStart, processingEnd: e.processingEnd, end: e.startTime + e.duration });
    }
    // 16 ms is the lowest threshold the browser allows; faster events are fine anyway.
  }).observe({ type: "event", buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
};

interface Result {
  screen: string;
  /** Main-thread tasks over BUDGET_MS, the longest of them, and their time beyond the budget. */
  over: number;
  worst: number;
  overMs: number;
  /** Lab INP: the slowest interaction, split into its three parts (all 0 when none was over 16 ms). */
  inp: number;
  inputDelay: number;
  processing: number;
  presentation: number;
  inpEvent: string;
  /** Long Animation Frames: blocking time summed, and the longest frames. */
  loafBlocking: number;
  loafs: Loaf[];
  ms: number;
  p95Frame: number;
  jank: number;
  heapMb: number;
  nodes: number;
  top: string[];
}

/** The functions that took the most time themselves (not counting what they called), from a CPU profile. */
function topFunctions(profile: { nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number } }[]; samples?: number[]; timeDeltas?: number[] }, n = 8): string[] {
  const byNode = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  const self = new Map<string, number>();
  (profile.samples ?? []).forEach((id, i) => {
    const f = byNode.get(id)!;
    const file = f.url.split("/").pop() || "(native)";
    const key = `${f.functionName || "(anonymous)"} ${file}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas?.[i] ?? 0) / 1000);
  });
  return [...self].filter(([k]) => !k.startsWith("(idle)") && !k.startsWith("(program)")).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, ms]) => `${Math.round(ms)} ms ${k}`);
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0;
};

// What DevTools' Performance panel records, so the saved traces open there with JS call stacks.
// Playwright's default also turns on high-resolution sampling, which DevTools does not.
const CATEGORIES = [
  "-*",
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "disabled-by-default-devtools.timeline.stack",
  "disabled-by-default-v8.cpu_profiler",
  "v8.execute",
  "toplevel",
  "blink.console",
  "blink.user_timing",
  "latencyInfo",
  "__metadata",
];

// The trace engine is DevTools' own, and expects a browser's DOMRect.
polyfillDOMRect();

/**
 * From the trace, as DevTools' Performance panel finds them: the duration in ms of every task
 * the page's main thread ran, and of every frame Chrome drew.
 */
async function fromTrace(trace: Buffer): Promise<{ tasks: number[]; frames: number[] }> {
  const model = Trace.TraceModel.Model.createWithAllHandlers();
  await model.parse(JSON.parse(trace.toString()).traceEvents);
  const data = model.parsedTrace()!.data;
  const threads = Trace.Handlers.Threads.threadsInTrace(data).filter((t) => t.type === Trace.Handlers.Threads.ThreadType.MAIN_THREAD && t.processIsOnMainFrame);
  if (!threads.length) throw new Error("no main thread in the trace");
  const tasks = threads.flatMap((t) => {
    // Playwright's and our DevTools commands run on the page's main thread, inside the JS that is
    // running when they arrive (a V8 API interrupt). In the field no DevTools is attached: not app work.
    const devtools = t.entries.filter((e) => e.name === "V8.InvokeApiInterruptCallbacks");
    return t.entries.filter(Trace.Types.Events.isRunTask).map((task) => {
      const end = task.ts + task.dur;
      // One still running when the trace stopped has no end; it stays counted, which errs high.
      const inside = devtools.filter((e) => e.ts >= task.ts && e.ts < end).reduce((a, e) => a + (e.dur ?? 0), 0);
      return (task.dur - inside) / 1000;
    });
  });
  // Idle frames had nothing to draw, so their length is not a delay anyone saw.
  const frames = data.Frames.frames.filter((f) => !f.idle).map((f) => f.duration / 1000);
  return { tasks, frames };
}

/**
 * The run's slowest interaction. Its entries are merged as web-vitals' INP attribution does:
 * input delay until the first handler ran, processing until the last one ended, then presentation.
 */
function slowest(events: EventEntry[]): Interaction | undefined {
  const all = [...Map.groupBy(events, (e) => e.id).values()].map((es) => {
    const start = Math.min(...es.map((e) => e.start));
    const processingStart = Math.min(...es.map((e) => e.processingStart));
    const processingEnd = Math.max(...es.map((e) => e.processingEnd));
    const end = Math.max(...es.map((e) => e.end));
    return { name: es.map((e) => e.name).join(", "), delay: processingStart - start, processing: processingEnd - processingStart, presentation: end - processingEnd, duration: end - start };
  });
  return all.reduce<Interaction | undefined>((a, e) => (!a || e.duration > a.duration ? e : a), undefined);
}

async function measure(page: Page, cdp: CDPSession, screen: string, action: () => Promise<void>): Promise<{ result: Result; trace: Buffer; profile: object }> {
  await page.evaluate(() => {
    const w = window as unknown as { __perf: Probe };
    w.__perf.loafs = [];
    w.__perf.events = [];
  });
  await cdp.send("HeapProfiler.collectGarbage");
  // Before the trace: starting the profiler is a main-thread task of hundreds of ms at CPU 10× (#450).
  await cdp.send("Profiler.start");
  await page.context().browser()!.startTracing(page, { categories: CATEGORIES });
  const t = performance.now();
  await action();
  const ms = performance.now() - t;
  const trace = await page.context().browser()!.stopTracing();
  const { profile } = await cdp.send("Profiler.stop");
  const { tasks: all, frames } = await fromTrace(trace);
  const tasks = all.filter((d) => d > BUDGET_MS);
  const { loafs, events } = await page.evaluate(() => (window as unknown as { __perf: Probe }).__perf);
  const { metrics } = await cdp.send("Performance.getMetrics");
  // Live elements (Chrome's "Nodes" metric also counts detached ones awaiting GC).
  const nodes = await page.evaluate(() => document.getElementsByTagName("*").length);
  const metric = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
  const inp = slowest(events);
  return {
    trace,
    profile,
    result: {
      screen,
      over: tasks.length,
      worst: Math.round(Math.max(0, ...tasks)),
      overMs: Math.round(tasks.reduce((a, d) => a + d - BUDGET_MS, 0)),
      inp: Math.round(inp?.duration ?? 0),
      inputDelay: Math.round(inp?.delay ?? 0),
      processing: Math.round(inp?.processing ?? 0),
      presentation: Math.round(inp?.presentation ?? 0),
      inpEvent: inp?.name ?? "",
      loafBlocking: Math.round(loafs.reduce((a, l) => a + l.blocking, 0)),
      loafs: [...loafs].sort((a, b) => b.duration - a.duration).slice(0, 3),
      ms: Math.round(ms),
      p95Frame: Math.round(pct(frames, 95)),
      jank: frames.filter((f) => f > 50).length,
      heapMb: Math.round(metric("JSHeapUsedSize") / 1e6),
      nodes,
      top: topFunctions(profile),
    },
  };
}

// Full Chromium, not the headless shell: it draws WebGL on the real GPU. The shell's software
// WebGL (SwiftShader) built its pipelines at the first draws while the main thread waited in
// Commit, 0.6 to 1.5 s at CPU 10×: a laptop with any GPU does not have that wait (#459).
const browser = await chromium.launch({ channel: "chromium", args: ["--mute-audio"] });

/** A fresh context per run, so no run inherits another's state, timers or heap. */
async function open(): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: REDUCED ? "reduce" : "no-preference" });
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  await page.addInitScript(PROBE);
  // Silent, as in e2e/test.ts: --mute-audio does not reach speechSynthesis on macOS.
  await page.addInitScript(() => {
    if ("SpeechSynthesis" in window) SpeechSynthesis.prototype.speak = () => {};
  });
  await page.addInitScript(() => localStorage.setItem("garden-quality", "normal"));
  const cdp = await context.newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Profiler.enable");
  await cdp.send("HeapProfiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  // Seed the demo learner at full speed.
  // Today's start button, whatever it says: the demo learner's day is often done ("Practice more").
  await page.goto(`${BASE}/?demo=es#/today`);
  await page.locator("button.start").waitFor({ timeout: 60_000 });
  return { context, page, cdp };
}

interface Scenario { name: string; setup?: (page: Page) => Promise<void>; action: (page: Page) => Promise<void> }

const scroll = async (page: Page) => {
  for (let n = 0; n < 15; n++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(100);
  }
};
// Moving between tabs, as a learner does: the app stays loaded, only the screen changes.
const tab = (page: Page, name: string) => page.locator("nav.top").getByRole("tab", { name }).click();
const onScreen = async (page: Page, hash: string, ready: () => Promise<unknown>) => {
  await page.goto(`${BASE}/${hash}`);
  await ready();
  await page.waitForTimeout(1000);
};
const today = (page: Page) => page.locator("button.start").waitFor();
const words = (page: Page) => page.locator("ul.words li").first().waitFor();

const SCENARIOS: Scenario[] = [
  // From about:blank: a goto to the URL the page is at only changes the hash, and loads no script (#461).
  { name: "Today: cold load", setup: async (page) => void (await page.goto("about:blank")), action: (page) => onScreen(page, "#/today", () => today(page)) },
  { name: "Garden: open and scroll", action: async (page) => { await page.goto(`${BASE}/#/garden`); await page.waitForTimeout(1500); await scroll(page); } },
  { name: "Words: open and scroll", action: async (page) => { await page.goto(`${BASE}/#/words`); await page.waitForTimeout(1500); await scroll(page); } },
  {
    name: "Session: 10 cards",
    action: async (page) => {
      await page.goto(`${BASE}/#/today`);
      await page.locator("button.start").click();
      await page.locator(".kicker").waitFor();
      // Each card as a learner answers it: show the answer, then "I remembered" (2).
      // A writing card: Enter checks, Enter goes on. Then wait for the next card.
      for (let n = 0; n < 10; n++) {
        const card = await page.locator(".session").getAttribute("data-card");
        const write = (await page.locator("input.answer").count()) > 0;
        await page.keyboard.press(write ? "Enter" : "Space");
        await page.waitForTimeout(500);
        await page.keyboard.press(write ? "Enter" : "2");
        await page.waitForFunction((c) => document.querySelector(".session")?.getAttribute("data-card") !== c, card, { polling: 100 });
        await page.waitForTimeout(500);
      }
    },
  },
  { name: "Tab: Settings → Today", setup: (page) => onScreen(page, "#/settings", () => page.getByRole("heading", { name: "Settings" }).waitFor()), action: async (page) => { await tab(page, "Today"); await today(page); await page.waitForTimeout(1000); } },
  { name: "Tab: Today → Words", setup: (page) => onScreen(page, "#/today", () => today(page)), action: async (page) => { await tab(page, "Words"); await words(page); await page.waitForTimeout(1000); } },
  { name: "Tab: Words → Today", setup: (page) => onScreen(page, "#/words", () => words(page)), action: async (page) => { await tab(page, "Today"); await today(page); await page.waitForTimeout(1000); } },
  {
    name: "3D walk: open and walk",
    action: async (page) => {
      await page.goto(`${BASE}/#/today`);
      await page.getByRole("button", { name: "Walk in your garden" }).click();
      await page.locator("canvas").waitFor();
      await page.keyboard.down("w");
      await page.waitForTimeout(3000);
      await page.keyboard.up("w");
    },
  },
];

// One run varies with what else the machine does: report the median and p90 of RUNS per number.
const median = (xs: number[]) => pct(xs, 50);
const p90 = (xs: number[]) => pct(xs, 90);
interface Summary { median: Result; p90: Result; worstRun: Result }
const summaries: Summary[] = [];
for (const sc of SCENARIOS.filter((sc) => !ONLY || sc.name.toLowerCase().includes(ONLY.toLowerCase()))) {
  const each: Result[] = [];
  const file = sc.name.replace(/\W+/g, "-");
  for (let n = 0; n < RUNS; n++) {
    const t = performance.now();
    const { context, page, cdp } = await open();
    // Once at full speed first, unmeasured: a learner has opened this screen before, so its
    // code is compiled and cached. The first visit in a new browser is about 2-3× slower.
    await sc.setup?.(page);
    await sc.action(page);
    console.log(`${sc.name}, run ${n + 1}/${RUNS}: learner ready and screen warmed up in ${((performance.now() - t) / 1000).toFixed(1)} s`);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
    await sc.setup?.(page);
    const { result, trace, profile } = await measure(page, cdp, sc.name, () => sc.action(page));
    await context.close();
    // Keep the files of the run with the most time over budget: that is the one to open in DevTools.
    if (!each.length || result.overMs > Math.max(...each.map((r) => r.overMs))) {
      writeFileSync(join(OUT, `${file}.trace.json`), trace);
      writeFileSync(join(OUT, `${file}.cpuprofile`), JSON.stringify(profile));
    }
    each.push(result);
  }
  const worstRun = each.reduce((a, r) => (r.overMs > a.overMs ? r : a));
  // The INP split comes from the run with the median INP, so its parts add up.
  const inpRun = [...each].sort((a, b) => a.inp - b.inp)[Math.floor(each.length / 2)];
  const numbers = (pick: (xs: number[]) => number): Result => {
    const m = (k: "over" | "worst" | "overMs" | "inp" | "loafBlocking" | "ms" | "p95Frame" | "jank" | "heapMb" | "nodes") => pick(each.map((r) => r[k]));
    return { ...inpRun, loafs: worstRun.loafs, top: worstRun.top, over: m("over"), worst: m("worst"), overMs: m("overMs"), inp: m("inp"), loafBlocking: m("loafBlocking"), ms: m("ms"), p95Frame: m("p95Frame"), jank: m("jank"), heapMb: m("heapMb"), nodes: m("nodes") };
  };
  summaries.push({ median: numbers(median), p90: numbers(p90), worstRun });
}

await browser.close();
server.kill();

const short = (url: string) => url.split("/").pop() || "(no source URL)";
const loafLine = (l: Loaf) => {
  const scripts = [...l.scripts].sort((a, b) => b.ms - a.ms).slice(0, 2).map((s) => `${Math.round(s.ms)} ms ${s.fn || "(anonymous)"} ${short(s.url)}:${s.char} (${s.invoker})`);
  return `- ${Math.round(l.duration)} ms frame, ${Math.round(l.blocking)} ms blocking: ${scripts.join("; ") || "no script (style, layout or paint)"}`;
};

const report = `# UI performance (production build, ${THROTTLE}, ${RUNS === 1 ? "1 run" : `median of ${RUNS} runs`}, every Spanish deck word studied${REDUCED ? ", reduced motion" : ""}${REACT_PROFILING ? ", React profiling build" : ""})

| Screen | Tasks > ${BUDGET_MS} ms | Worst ms | Over budget ms | Worst ms p90 | Over budget ms p90 | INP ms | INP ms p90 | LoAF blocking ms | Took ms | p95 frame ms | Frames > 50 ms | JS heap MB | DOM nodes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
${summaries.map(({ median: r, p90: q }) => `| ${r.screen} | ${r.over} | ${r.worst} | ${r.overMs} | ${q.worst} | ${q.overMs} | ${r.inp || "< 16"} | ${q.inp || "< 16"} | ${r.loafBlocking} | ${r.ms} | ${r.p95Frame} | ${r.jank} | ${r.heapMb} | ${r.nodes} |`).join("\n")}

The bar: no main-thread task over ${BUDGET_MS} ms. Over budget ms: the time beyond ${BUDGET_MS} ms, summed over those tasks.
INP ms: the slowest click or key press, from input to the next paint (lab INP; Event Timing only sees those over 16 ms).
LoAF blocking ms: per long animation frame (over 50 ms), its time beyond 50 ms, summed.

## Per screen

${summaries
  .map(({ median: r, worstRun: w }) => `### ${r.screen}

${r.inp ? `Slowest interaction (${r.inpEvent}, median run): ${r.inp} ms = ${r.inputDelay} input delay + ${r.processing} processing + ${r.presentation} presentation.` : "No interaction over 16 ms."}

Longest animation frames, with the scripts that ran in them (run with the most time over budget, ${w.overMs} ms):
${r.loafs.map(loafLine).join("\n") || "- none over 50 ms"}

Self time per function (same run):
${r.top.map((t) => `- ${t}`).join("\n")}`)
  .join("\n\n")}

The 3D walk draws on this machine's GPU, which the CPU slowdown does not slow: an old laptop's GPU is slower.
Per screen, that run's Chrome trace (*.trace.json) and CPU profile (*.cpuprofile) are in perf/out/: open them in Chrome DevTools → Performance.
`;
writeFileSync(join(OUT, "report.md"), report);
console.log(report);
