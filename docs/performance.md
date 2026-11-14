# Performance

Two local runs, both against the local stack (`docker compose up -d`). Run them before a launch and after changes to sync, the garden, or the session, and compare with the baseline below.

## Server: load test with CPU and heap profiles

```sh
cd server && bun run load -- --users 100 --seconds 30
```

It starts a profiled server and simulates learners as the app behaves: an anonymous sign-in, a course, then reviews written in small batches, and the learner's rows read at start and now and then (`server/load/run.ts`). Output in `server/load/out/`:

- `report.md`: p50/p95/p99 per request, writes per second, server memory over the run.
- `CPU.*.cpuprofile` (Chrome DevTools → Performance, or speedscope.app) and `CPU.*.md`, a grep-friendly summary of hot functions.
- `Heap.*.md`: a heap summary at exit (largest types and retainers).

## UI: production build on a slow CPU

### The bar

No main-thread task over 10 ms, with the CPU slowed 10× (#447). A task that runs longer makes a tap or key press wait. 10 ms is RAIL's budget: of the 16.7 ms in one frame, about 10 ms are for our code. On Geekbench 6 single-core, an Apple M4 is about 10× faster than a 2011 Sandy Bridge i3 laptop and about 30× faster than an AMD E-450. So `--cpu 10` on an M4 is about a 2011 budget laptop. Use `--cpu 25` to check the slowest laptops.

### How to run it

```sh
cd web && bun run perf
```

It builds the app (with the demo switch on), starts the real server, and creates a learner with every Spanish deck word studied. Then it measures each heavy screen: Today, the garden, the word list, ten session cards, tab changes, the 3D walk. Each run uses a new browser context with a newly made learner, so one run does not inherit state or heap from the last. Before it measures, each run does the screen once at full speed, because a learner has opened the screen before: its code is then compiled and cached. The first visit in a new browser is 2–3× slower. Making the learner and the warm-up take a few seconds per run.

**Do not measure an obvious win.** A change that is faster by construction (all rows → changed rows, work no longer repeated, a cached pure result) needs no before and after runs: the PR states the change in complexity. Measure to find where the time goes, or when the effect is not certain (scheduling, yielding, GPU, layout). Explore with `--runs 1 --only <screen>`, and take "before" from `web/perf/baseline.json`.

Numbers from before 2026-11-06 (harness v1, #447 baseline) are not comparable: v1 used one page for all runs, so its first run was cold and its later runs had one or more warm-ups. Measure before and after a change with the same version.

Worst ms, Over budget ms, LoAF blocking ms and the frame columns from before the fix in #450 (2026-11-06) count DevTools work as app work. The profiler start alone was one task of 300–650 ms at CPU 10×. Do not compare them with later numbers.

- `--runs <n>`: run each screen n times (default 3). The report shows the median, and the p90 for the main numbers. One run varies with what else the machine does.
- `--only <text>`: only the screens whose name has this text.
- `--cpu <n>`: slow the CPU n times (default 10).
- `--no-minify`: readable function names in profiles and frame scripts.
- `--react-profiling`: use React's profiling build (`react-dom/profiling`). The saved traces then show React's "Scheduler ⚛" track in DevTools: each update, with its render and commit, and cascading updates. With React 19.3, the Components track did not show in this build.
- `--reduced-motion`: measure with animations off.

### How to read the report

Output is in `web/perf/out/`. `report.md` has one table and then a section per screen.

- **Tasks > 10 ms, Worst ms, Over budget ms**: main-thread tasks longer than the budget, the longest one, and their time beyond 10 ms added up. These come from the Chrome trace, read by the DevTools trace engine (`@paulirish/trace_engine`, the same code as the Performance panel). These are the numbers for the bar. DevTools commands (Playwright's clicks and checks, the profiler) run on the page's main thread, inside the JS that is running when they arrive. In the trace they are `V8.InvokeApiInterruptCallbacks`, and their time is taken out of the task: no DevTools is attached in the field. Promise callbacks (microtasks) run inside the task that started them, so a chain of `await`s with no real waiting is one long task here. A chain that waits for I/O (fetch, IndexedDB, messages) is many short tasks. It is slow, but no single task blocks, so look at INP and Took ms for it.
- **… p90**: the same, at the 90th percentile of the runs. With 5 runs, this is the worst run.
- **INP ms**: lab INP, the slowest click or key press from input to the next paint (Event Timing). "< 16" means no interaction took 16 ms or more. Screens with no click or key press (cold load, scrolling) have none. The section per screen splits it into input delay (the main thread was busy), processing (our event handlers) and presentation (render, layout and paint after them). Field INP is "good" under 200 ms.
- **LoAF blocking ms**: Long Animation Frames over 50 ms. For each, its time beyond 50 ms, added up. The section per screen lists the longest frames with the scripts that ran in them: time, function, file and character position, and what called it (an event listener, a timer, a promise).
- **Took ms, p95 frame ms, Frames > 50 ms, JS heap MB, DOM nodes**: the time the scenario took, the frames Chrome drew (from the trace's frame track, not counting idle frames), and memory and DOM size at the end.
- **Self time per function**: from the CPU profile, the functions that took the most time themselves.

LoAF blocking and the self time per function still include DevTools command time. It is charged to whatever JS was on the stack, often Playwright's `markTargetElements` during a click. Before #450, the harness counted frames with its own requestAnimationFrame loop. That loop was often on the stack, so the profiler start (about 300–650 ms at CPU 10×) showed as a long "(anonymous) (no source URL)" or `sentryWrapped` frame script.

For each screen, the run with the most time over budget saves its Chrome trace (`*.trace.json`) and CPU profile (`*.cpuprofile`). Drag them into Chrome DevTools → Performance.

The browser is full Chromium in headless mode, so WebGL draws on the machine's real GPU. The CPU slowdown does not slow the GPU, and an old laptop's GPU is much slower than an M4's, so the 3D walk's frames are faster here than on that laptop. Before 2026-11-06 (#459), the harness used software WebGL (SwiftShader). Its first draws made the main thread wait 0.6–1.5 s in Commit at CPU 10×. Do not compare the walk's Worst ms and Over budget ms from before then.

## Baseline

### UI: the ratchet

`web/perf/baseline.json` stores three numbers per screen: Worst ms, Over budget ms and INP ms, each the median of a run with the default settings (#985). `bun run perf` compares each run with it:

- **Clearly worse fails.** A number is clearly worse when even the screen's best run is over its limit: 1.25 × the stored number + 10 ms. The run then exits 1, and the report's "Ratchet" section names each number. One slow run can be the machine; three slow runs are the change.
- **Clearly better is stored.** When the stored number is over the limit of the new median, the new median replaces it. Commit `baseline.json` with the change that made it faster, so it cannot get slow again unseen.
- A new screen is stored. A screen that is no longer measured is removed. With `--only`, the other screens keep their numbers.
- **Not compared:** a run with other settings (`--cpu`, fewer than 3 runs, `--no-minify`, `--reduced-motion`, `--react-profiling`), a run on a busy machine (a 1-minute load average over the number of cores after any screen), or a run on another machine than the one in the file (its CPU model). With no file, the first run that is compared stores its numbers. To start over on a new machine, delete the file.

On a quiet machine the p90 of 3 runs was within 5% of the median (Today's cold load, #924), so the margin is wide. A busy machine is far noisier: at a load average of 24 to 52 on 14 cores, the Session's p90 over budget was 2.7× its median (#985). So do not run it while e2e runs are going on.

The bar is still 10 ms, and most screens miss it (#924; the open debt is #421). The ratchet only stops them from getting worse. The baselines before it are in #447 (2026-11-06).

### Server

There is no current server baseline: run the load test before and after your change. The numbers that stood here until 2026-11-14 were removed. The server ones (2026-10-11) timed a write coming back over a live sync connection that the app no longer has. The UI ones used CPU 4× and a deck half today's size.
