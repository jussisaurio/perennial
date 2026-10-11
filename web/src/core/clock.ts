// Counts only time a learner is actually present: the page is visible and
// they've touched or typed recently. A cat video in another tab, or a phone
// left on the table, doesn't use up the session.

export class ActiveClock {
  private elapsedMs = 0;
  private last: number;
  private lastInput: number;
  private visible = true;
  private readonly idleMs: number;
  /** Longest gap credited between ticks, so throttled timers can't add a lump. */
  private readonly maxStepMs: number;

  constructor(now: number, idleMs = 45_000, maxStepMs = 2_000) {
    this.last = now;
    this.lastInput = now;
    this.idleMs = idleMs;
    this.maxStepMs = maxStepMs;
  }

  tick(now: number): number {
    const step = Math.min(now - this.last, this.maxStepMs);
    if (this.visible && now - this.lastInput <= this.idleMs && step > 0) this.elapsedMs += step;
    this.last = now;
    return this.elapsedMs;
  }

  input(now: number): void {
    this.tick(now);
    this.lastInput = now;
  }

  setVisible(visible: boolean, now: number): void {
    this.tick(now);
    this.visible = visible;
    // Coming back counts as presence; time away does not.
    if (visible) this.lastInput = now;
  }

  get elapsed(): number {
    return this.elapsedMs;
  }
}
