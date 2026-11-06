# Performance

Two local runs, both against the local stack (`docker compose up -d`). Run them before a launch and after changes to sync, the garden, or the session, and compare with the baseline below.

## Server: load test with CPU and heap profiles

```sh
cd server && bun run load -- --users 100 --seconds 30
```

It starts a profiled server and simulates learners as the app behaves: an anonymous sign-in, a course, then a review every 2–5 s while a live shape poll waits for the write to sync back. Output in `server/load/out/`:

- `report.md`: p50/p95/p99 per request, write → synced-back latency (Electric echo), writes per second, server memory over the run.
- `CPU.*.cpuprofile` (Chrome DevTools → Performance, or speedscope.app) and `CPU.*.md`, a grep-friendly summary of hot functions.
- `Heap.*.md`: a heap summary at exit (largest types and retainers).

## UI: production build on a slow CPU

### The bar

No main-thread task over 10 ms, with the CPU slowed 10× (#447). A task that runs longer makes a tap or key press wait. 10 ms is RAIL's budget: of the 16.7 ms in one frame, about 10 ms are for our code. On Geekbench 6 single-core, an Apple M4 is about 10× faster than a 2011 Sandy Bridge i3 laptop and about 30× faster than an AMD E-450. So `--cpu 10` on an M4 is about a 2011 budget laptop. Use `--cpu 25` to check the slowest laptops.

### How to run it

```sh
cd web && bun perf/ui.ts --runs 5 --only "Words"
```

It builds the app (with the demo switch on), starts the real server, and creates a learner with every Spanish deck word studied. Then it measures each heavy screen: Today, the garden, the word list, ten session cards, tab changes, the 3D walk. Each run uses a new browser context with a newly made learner, so one run does not inherit state or heap from the last. Before it measures, each run does the screen once at full speed, because a learner has opened the screen before: its code is then compiled and cached. The first visit in a new browser is 2–3× slower. Making the learner and the warm-up take a few seconds per run.

Numbers from before 2026-11-06 (harness v1, #447 baseline) are not comparable: v1 used one page for all runs, so its first run was cold and its later runs had one or more warm-ups. Measure before and after a change with the same version.

- `--runs <n>`: run each screen n times. The report shows the median, and the p90 for the main numbers. Use 5 to compare before and after a change: one run varies with what else the machine does.
- `--only <text>`: only the screens whose name has this text.
- `--cpu <n>`: slow the CPU n times (default 10).
- `--no-minify`: readable function names in profiles and frame scripts.
- `--react-profiling`: use React's profiling build (`react-dom/profiling`). The saved traces then show React's "Scheduler ⚛" track in DevTools: each update, with its render and commit, and cascading updates. With React 19.3, the Components track did not show in this build.
- `--reduced-motion`: measure with animations off.

### How to read the report

Output is in `web/perf/out/`. `report.md` has one table and then a section per screen.

- **Tasks > 10 ms, Worst ms, Over budget ms**: main-thread tasks longer than the budget, the longest one, and their time beyond 10 ms added up. These come from the Chrome trace, read by the DevTools trace engine (`@paulirish/trace_engine`, the same code as the Performance panel). These are the numbers for the bar.
- **… p90**: the same, at the 90th percentile of the runs. With 5 runs, this is the worst run.
- **INP ms**: lab INP, the slowest click or key press from input to the next paint (Event Timing). "< 16" means no interaction took 16 ms or more. Screens with no click or key press (cold load, scrolling) have none. The section per screen splits it into input delay (the main thread was busy), processing (our event handlers) and presentation (render, layout and paint after them). Field INP is "good" under 200 ms.
- **LoAF blocking ms**: Long Animation Frames over 50 ms. For each, its time beyond 50 ms, added up. The section per screen lists the longest frames with the scripts that ran in them: time, function, file and character position, and what called it (an event listener, a timer, a promise).
- **Took ms, p95 frame ms, Frames > 50 ms, JS heap MB, DOM nodes**: the time the scenario took, frame times from requestAnimationFrame, and memory and DOM size at the end.
- **Self time per function**: from the CPU profile, the functions that took the most time themselves.

A long frame whose script is "(anonymous) (no source URL)" from a FrameRequestCallback is the harness's own frame counter. It is not slow itself. Chrome slows the CPU by pausing the page when JS next runs, so the pause for earlier work (style, layout, parsing) can land in that callback. In the trace it shows as `V8.InvokeApiInterruptCallbacks`. Count it as time the page was busy, but look at the work before it.

For each screen, the run with the most time over budget saves its Chrome trace (`*.trace.json`) and CPU profile (`*.cpuprofile`). Drag them into Chrome DevTools → Performance.

The 3D walk uses software WebGL in headless Chrome, so its frame times are worse than on a real GPU.

## Baseline (2026-10-11, M-series laptop)

Server, 100 learners for 20 s: no errors; write p95 8 ms; write → synced back p95 11 ms; ~30 writes/s; RSS 181 → 196 MB. CPU is spread out: Better Auth's session lookup (kysely query building, pg row parsing) is the largest app-side cost.

UI, CPU 4× slower, 400 words studied (after the 2D garden became a virtualized strip): Today 0 ms blocked and ~800 DOM elements; Words 22 ms; ten session cards 43 ms; the 3D garden blocks ~0.8 s while it opens (≈ 0.2 s at full speed), about the same with 200 or 400 plants, so it is setup cost (software WebGL in this run), not per-plant.

UI, 2026-11-06, CPU 4× slower, every Spanish deck word studied (about 1030): blocked main-thread time is Today 0 ms (1040 DOM elements), Words 61 ms, ten session cards 591 ms (longest task 527 ms), the Garden tab 2.1 s, the 3D walk 2.4 s. Sessions and the Garden tab are much slower than in October; that is worth a look of its own.
