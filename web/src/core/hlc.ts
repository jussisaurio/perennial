// Hybrid logical clock. Stamps are strings that sort lexicographically in
// causal order: "<13-digit ms>:<4-digit counter>:<device>".

export class HLC {
  private ms = 0;
  private counter = 0;
  readonly device: string;
  private readonly clock: () => number;

  constructor(device: string, clock: () => number = Date.now) {
    this.device = device;
    this.clock = clock;
  }

  now(): string {
    const wall = this.clock();
    if (wall > this.ms) {
      this.ms = wall;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return format(this.ms, this.counter, this.device);
  }

  /** Advance past a stamp received from another device. */
  observe(stamp: string): void {
    const { ms, counter } = parse(stamp);
    if (ms > this.ms || (ms === this.ms && counter > this.counter)) {
      this.ms = ms;
      this.counter = counter;
    }
  }
}

function format(ms: number, counter: number, device: string): string {
  return `${String(ms).padStart(13, "0")}:${String(counter).padStart(4, "0")}:${device}`;
}

export function parse(stamp: string): { ms: number; counter: number; device: string } {
  const [ms, counter, device] = stamp.split(":");
  return { ms: Number(ms), counter: Number(counter), device };
}
