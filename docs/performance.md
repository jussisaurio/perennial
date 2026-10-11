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

```sh
cd web && bun run perf -- --cpu 4
```

It builds the app (with the demo switch on), creates a learner with every Spanish deck word studied, and measures each heavy screen with the CPU slowed 4× (about a mid-range phone): Today, the garden, the word list, ten session cards, the 3D walk. Output in `web/perf/out/`:

- `report.md`: per screen, long tasks and blocked main-thread time, p95 frame time and frames over 50 ms, JS heap, DOM nodes.
- One `.cpuprofile` per screen.

The 3D walk uses software WebGL in headless Chrome, so its frame times are worse than on a real GPU.

## Baseline (2026-10-11, M-series laptop)

Server, 100 learners for 20 s: no errors; write p95 8 ms; write → synced back p95 11 ms; ~30 writes/s; RSS 181 → 196 MB. CPU is spread out: Better Auth's session lookup (kysely query building, pg row parsing) is the largest app-side cost.

UI, CPU 4× slower, 400 words studied (after the 2D garden became a virtualized strip): Today 0 ms blocked and ~800 DOM elements; Words 22 ms; ten session cards 43 ms; the 3D garden blocks ~0.8 s while it opens (≈ 0.2 s at full speed), about the same with 200 or 400 plants, so it is setup cost (software WebGL in this run), not per-plant.
