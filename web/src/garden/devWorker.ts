// Imported first by spriteWorker.ts. In dev only, @vitejs/plugin-react's Fast
// Refresh runtime (imported by every .tsx module, ui/plant.tsx too) sets
// properties on `window` when it loads, and a worker has no window: it throws.
// The production build has no Fast Refresh.
if (import.meta.env.DEV) (globalThis as { window?: unknown }).window = globalThis;
