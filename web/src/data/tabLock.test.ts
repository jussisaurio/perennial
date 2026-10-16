import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { tabLock } from "./tabLock";

/** Web Locks as the browser does them, for exclusive locks: one holder, the rest in line in order. */
class FakeLocks {
  private held = new Set<string>();
  private line: { name: string; grant: () => void }[] = [];

  request(name: string, opts: { signal?: AbortSignal }, callback: () => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      const grant = () => {
        this.held.add(name);
        void callback().then(() => {
          this.held.delete(name);
          resolve();
          this.next(name);
        });
      };
      if (!this.held.has(name)) return grant();
      const waiting = { name, grant };
      this.line.push(waiting);
      opts.signal?.addEventListener("abort", () => {
        this.line = this.line.filter((w) => w !== waiting);
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  }

  private next(name: string) {
    const i = this.line.findIndex((w) => w.name === name);
    if (i < 0) return;
    const [w] = this.line.splice(i, 1);
    w!.grant();
  }
}

/** Let promise callbacks run. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => {
  jest.useFakeTimers();
  Object.defineProperty(globalThis.navigator, "locks", { value: new FakeLocks(), configurable: true });
});
afterEach(() => {
  jest.useRealTimers();
  Reflect.deleteProperty(globalThis.navigator, "locks");
});

test("the first tab writes; a second tab says it is not the writer after 2.5 s", async () => {
  const first = tabLock("perennial-writer-u1")!;
  const second = tabLock("perennial-writer-u1")!;
  expect(await first.requestLeadership()).toBe(true);
  const answer = second.requestLeadership();
  jest.advanceTimersByTime(2499);
  await settle();
  expect(second.isLeader()).toBe(false);
  jest.advanceTimersByTime(1);
  expect(await answer).toBe(false);
});

test("a tab that lost the race stays in line, and writes once the first tab closes", async () => {
  const first = tabLock("perennial-writer-u1")!;
  const second = tabLock("perennial-writer-u1")!;
  await first.requestLeadership();
  const changes: boolean[] = [];
  second.onLeadershipChange((v) => changes.push(v));
  const answer = second.requestLeadership();
  jest.advanceTimersByTime(2500);
  expect(await answer).toBe(false);

  first.releaseLeadership();
  await settle();
  expect(first.isLeader()).toBe(false);
  expect(second.isLeader()).toBe(true);
  expect(changes).toEqual([true]);
});

test("a tab that is still in line can leave it: the lock goes to the next one", async () => {
  const first = tabLock("perennial-writer-u1")!;
  const second = tabLock("perennial-writer-u1")!;
  const third = tabLock("perennial-writer-u1")!;
  await first.requestLeadership();
  const answers = [second.requestLeadership(), third.requestLeadership()];
  jest.advanceTimersByTime(2500);
  expect(await Promise.all(answers)).toEqual([false, false]);

  second.releaseLeadership();
  first.releaseLeadership();
  await settle();
  expect(second.isLeader()).toBe(false);
  expect(third.isLeader()).toBe(true);
});
