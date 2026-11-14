/**
 * Width of the framebuffer, in pixels, for each level of detail. Normal
 * renders at about screen resolution on most screens. Low renders coarser
 * and is scaled up, for slow devices. Best first.
 */
export const DETAIL = { normal: 2160, low: 760 } as const;
export type Detail = keyof typeof DETAIL;
const LEVELS = Object.keys(DETAIL) as Detail[];

/** Frames are judged a second at a time, by their median: one long task (a card opening) is not a slow device. */
const WINDOW_MS = 1000;
/** Most frames one window holds: a second at 240 Hz. */
const MAX_FRAMES = 256;
/** Frames ignored after the start, a change of detail (a new drawing buffer) and the tab being hidden or shown. */
const SETTLE_MS = 1000;
/** A window is slow when its median frame is longer: under 25 fps. Not 30 fps, which a phone in low power mode is held to. */
const SLOW_MS = 40;
/** A window is good when its median frame is this or shorter: the display keeps up. */
const GOOD_MS = 20;
/** Slow windows in a row before dropping a level. */
const DROP_AFTER = 2;
/** Good windows in a row before trying the level above. Doubled with each drop after the first, so a device on the edge does not flicker. */
const UP_AFTER = 10;
/** Slow windows in a row at the lowest level before it is reported (once). */
const REPORT_AFTER = 5;

/**
 * Picks the walk's detail from how long its frames take, as dynamic
 * resolution does in games: it drops a level after a few slow seconds and
 * steps back up after a long good run. The learner never has to choose.
 * Fed only frame times, so a test gives it a fixed list of them.
 */
export class DetailPicker {
  private level = 0;
  private drops = 0;
  private settle = SETTLE_MS;
  private skip = false;
  // Unused slots are Infinity, so a sort puts the window's frames first, in order: nothing is allocated per frame.
  private times = new Float32Array(MAX_FRAMES).fill(Infinity);
  private n = 0;
  private sum = 0;
  private slow = 0;
  private good = 0;
  private reported = false;

  private readonly change: (d: Detail) => void;
  private readonly tooSlow: (medianMs: number) => void;

  /** `tooSlow`: even the lowest level is slow, with the window's median frame in ms. Called once per picker. */
  constructor(change: (d: Detail) => void, tooSlow: (medianMs: number) => void) {
    this.change = change;
    this.tooSlow = tooSlow;
  }

  /** The tab was hidden or shown: the next frame spans the time away, and the ones after it settle again. */
  pause() {
    this.skip = true;
    this.restart();
  }

  /** One frame took `ms` (from the one before it). */
  frame(ms: number) {
    if (this.skip) {
      this.skip = false;
      return;
    }
    if (this.settle > 0) {
      this.settle -= ms;
      return;
    }
    this.times[this.n++] = ms;
    this.sum += ms;
    if (this.sum < WINDOW_MS && this.n < MAX_FRAMES) return;
    this.times.sort();
    const median = this.times[this.n >> 1];
    this.clearWindow();
    this.judge(median);
  }

  private judge(median: number) {
    if (median > SLOW_MS) {
      this.good = 0;
      this.slow++;
      if (this.level < LEVELS.length - 1) {
        if (this.slow >= DROP_AFTER) {
          this.drops++;
          this.set(this.level + 1);
        }
      } else if (this.slow >= REPORT_AFTER && !this.reported) {
        this.reported = true;
        this.tooSlow(median);
      }
    } else if (median <= GOOD_MS) {
      this.slow = 0;
      this.good++;
      if (this.level > 0 && this.good >= UP_AFTER * 2 ** (this.drops - 1)) this.set(this.level - 1);
    } else {
      // Between the two: neither a slow run nor a good one.
      this.slow = 0;
      this.good = 0;
    }
  }

  private set(level: number) {
    this.level = level;
    this.change(LEVELS[level]);
    this.restart();
  }

  private restart() {
    this.settle = SETTLE_MS;
    this.slow = 0;
    this.good = 0;
    this.clearWindow();
  }

  private clearWindow() {
    this.times.fill(Infinity);
    this.n = 0;
    this.sum = 0;
  }
}
