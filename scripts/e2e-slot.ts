// Holds one of the machine's few e2e slots for one Playwright run (#665).
// web/playwright.config.ts starts it as its first webServer: it waits for a free
// slot, then listens on <port>, and Playwright starts the rest when the port opens.
//
//   bun scripts/e2e-slot.ts <port>
//
// A slot is a file lock (flock). The kernel drops it when this process ends, even
// on kill -9, so a killed run never keeps its slot.

import { dlopen, FFIType } from "bun:ffi";
import { closeSync, mkdirSync, openSync } from "node:fs";

// A run starts a browser per two cores, plus vite and the API: three runs keep the
// load near the core count (#665).
const SLOTS = 3;
// In /tmp, not TMPDIR: every agent's runs must see the same files, and TMPDIR may differ.
const DIR = "/tmp/perennial-e2e";
const LOCK_EX = 2;
const LOCK_NB = 4;

const port = Number(process.argv[2]);
if (!Number.isInteger(port)) throw new Error("usage: bun scripts/e2e-slot.ts <port>");

// Playwright keeps this process's stdin open; it closes when the run ends, however it ends.
void Bun.stdin.text().then(() => process.exit(0));

const libc = dlopen(process.platform === "darwin" ? "libc.dylib" : "libc.so.6", {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
});

mkdirSync(DIR, { recursive: true });

/** A slot's number once this process holds its lock, or undefined if all are taken. */
function take(): number | undefined {
  for (let slot = 1; slot <= SLOTS; slot++) {
    const fd = openSync(`${DIR}/slot-${slot}`, "a");
    if (libc.symbols.flock(fd, LOCK_EX | LOCK_NB) === 0) return slot;
    closeSync(fd);
  }
  return undefined;
}

const start = Date.now();
let slot = take();
if (slot === undefined) {
  // Playwright shows a webServer's stderr, so the agent sees why its run is quiet.
  console.error(`Waiting for an e2e slot: ${SLOTS} runs are already going on this machine.`);
  while (slot === undefined) {
    await Bun.sleep(1000);
    slot = take();
  }
  console.error(`Got e2e slot ${slot} after ${Math.round((Date.now() - start) / 1000)} s.`);
}

Bun.serve({ port, fetch: () => new Response(`e2e slot ${slot}`) });
