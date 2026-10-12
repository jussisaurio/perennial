import { describe, expect, test } from "bun:test";
import { DAY_MS } from "./day";
import { FSRS } from "./fsrs";
import { plan, Session, type PlanInput, type Task } from "./session";
import type { MemoryRow } from "./memory";
import type { Skill } from "../data/rows";

const fsrs = new FSRS();
const now = Date.UTC(2026, 5, 1);
const FIVE = 5 * 60_000;

function mem(id: string, skill: Skill, daysAgo: number, s: number): MemoryRow {
  const lastTs = now - daysAgo * DAY_MS;
  return { key: `${id}:${skill}`, wordId: id, skill, s, d: 5, lastTs, due: lastTs + s * DAY_MS, reps: 3, lapses: 0 };
}
/** Unlocked, never practised. */
const unlocked = (id: string, skill: Skill): MemoryRow => ({ ...mem(id, skill, 0, 0), reps: 0, due: now - 1 });
const words = (n: number, prefix = "f") => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

function chunk(input: Partial<PlanInput>) {
  return plan({ now, budgetMs: FIVE, memories: [], fresh: [], fsrs, answeredToday: new Set(), ...input });
}
const ids = (queue: Task[]) => queue.map((t) => t.wordId);

describe("plan", () => {
  test("a fresh learner gets new words, as many as fit in the minutes", () => {
    const p = chunk({ fresh: words(40) });
    expect(p.newCount).toBe(12); // 5 min at 25 s per new word and its quick check
    expect(p.queue.every((t) => t.kind === "intro")).toBe(true);
    expect(chunk({ fresh: words(3) }).newCount).toBe(3);
  });

  test("due reviews come first and new words get only the time left", () => {
    const due = Array.from({ length: 20 }, (_, i) => mem(`d${i}`, "read", 12, 10));
    const p = chunk({ memories: due, fresh: words(40) });
    expect(p.newCount).toBe(5); // (300 s - 20 × 8 s) / 25 s
    expect(p.due).toBe(20);
    expect(p.queue[0].kind).toBe("review");
    // All 20 due reviews are in, whatever the timer cuts later.
    expect(ids(p.queue).filter((id) => id.startsWith("d"))).toHaveLength(20);
  });

  test("triage: overdue items with higher retrievability come first", () => {
    const memories = [mem("gone", "read", 60, 2), mem("fresh", "read", 11, 10), mem("mid", "read", 20, 10)];
    expect(ids(chunk({ budgetMs: 60_000, memories }).queue)).toEqual(["fresh", "mid", "gone"]);
  });

  test("one skill per word per session", () => {
    const memories = [mem("a", "read", 10, 5), mem("a", "write", 10, 3)];
    expect(chunk({ budgetMs: 60_000, memories }).queue).toEqual([{ kind: "review", wordId: "a", skill: "write" }]);
  });

  test("never-practised skills trickle in after real reviews, never ahead of them", () => {
    const memories = [...Array.from({ length: 10 }, (_, i) => unlocked(`n${i}`, "listen")), mem("slipping", "read", 20, 5), unlocked("w", "write")];
    const p = chunk({ budgetMs: 7 * 60_000, memories });
    expect(p.queue[0]).toEqual({ kind: "review", wordId: "slipping", skill: "read" });
    const newSkills = p.queue.filter((t) => t.kind === "review" && t.isNew);
    expect(newSkills.length).toBeLessThanOrEqual(4);
    expect(newSkills.length).toBeGreaterThan(0);
  });

  test("writing gets its turn: a new skill is offered when the word has nothing else due", () => {
    const memories = [mem("a", "read", 1, 30), unlocked("a", "write")];
    expect(chunk({ memories }).queue).toEqual([{ kind: "review", wordId: "a", skill: "write", isNew: true }]);
  });

  test("huge backlog: no new words; moderate backlog: a trickle", () => {
    const many = Array.from({ length: 200 }, (_, i) => mem(`w${i}`, "read", 30, 5));
    expect(chunk({ budgetMs: 7 * 60_000, memories: many, fresh: ["n1", "n2"] }).newCount).toBe(0);
    const some = many.slice(0, 60); // ~8 min of reviews in a 7 min session
    expect(chunk({ budgetMs: 7 * 60_000, memories: some, fresh: ["n1", "n2"] }).newCount).toBe(2);
  });

  test("each chunk is sized by its own minutes, and a binge comes back as reviews, not more new words", () => {
    // Chunk after chunk on one day: never more new words than fit in 5 minutes,
    // and words answered in an earlier chunk are not asked again.
    const first = chunk({ fresh: words(100) });
    const learnedToday = first.queue.map((t) => mem(t.wordId, "read", 0, 2));
    const second = chunk({ fresh: words(100).slice(first.newCount), memories: learnedToday, answeredToday: new Set(ids(first.queue)) });
    expect(second.newCount).toBe(12);
    expect(ids(second.queue).some((id) => ids(first.queue).includes(id))).toBe(false);
    // The next days: 48 words from a long evening fall due, and they fill the
    // chunk before any new word (only the trickle of 1–2 gets in).
    const binge = words(48, "b").map((id) => mem(id, "read", 3, 2));
    const nextDay = chunk({ memories: binge, fresh: words(100) });
    expect(nextDay.newCount).toBeLessThanOrEqual(2);
    expect(nextDay.queue.slice(0, 10).every((t) => t.kind === "review")).toBe(true);
  });

  test("a finished course: new skills, then what is due within a day (soonest first), then the weakest words", () => {
    const memories = [
      mem("strong", "read", 1, 100), // due in 99 days, recalled at ~100%
      mem("shaky", "read", 2.5, 4), // due in 36 h: not within a day
      mem("tonight", "read", 4.5, 5), // due in 12 h
      mem("soon", "read", 2.9, 3), // due in 2.4 h: within the 6 h horizon, so due now
      mem("later", "read", 4.2, 5), // due in ~19 h
      mem("w", "read", 1, 30),
      unlocked("w", "write"),
    ];
    const p = chunk({ memories });
    expect(p.newCount).toBe(0);
    expect(p.queue).toEqual([
      { kind: "review", wordId: "soon", skill: "read" },
      { kind: "review", wordId: "w", skill: "write", isNew: true },
      { kind: "review", wordId: "tonight", skill: "read" },
      { kind: "review", wordId: "later", skill: "read" },
      { kind: "review", wordId: "shaky", skill: "read" },
      { kind: "review", wordId: "strong", skill: "read" },
    ]);
  });

  test("never empty once anything is learned, even when nothing is due", () => {
    const p = chunk({ memories: [mem("later", "read", 1, 30)] });
    expect(p.queue).toEqual([{ kind: "review", wordId: "later", skill: "read" }]);
    expect(chunk({}).queue).toEqual([]); // nothing learned and no words left: nothing to give
  });

  test("a word answered correctly today is not asked again today, even when due", () => {
    const memories = [mem("done", "read", 20, 5), mem("due", "read", 20, 5), mem("other", "read", 1, 30), unlocked("done", "listen")];
    const p = chunk({ memories, fresh: ["n"], answeredToday: new Set(["done"]) });
    expect(ids(p.queue)).not.toContain("done");
    expect(ids(p.queue)).toEqual(expect.arrayContaining(["due", "n", "other"]));
  });

  test("only when every learned word was answered today and no new words are left, a second try beats an empty chunk", () => {
    const memories = [mem("a", "read", 1, 3), mem("b", "read", 1, 2)];
    const p = chunk({ memories, answeredToday: new Set(["a", "b"]) });
    expect(ids(p.queue)).toEqual(["b", "a"]); // weakest first
  });
});

describe("Session", () => {
  test("intro gets a follow-up test; failures retry; time-up drains follow-ups only", () => {
    const queue: Task[] = [
      { kind: "intro", wordId: "n" },
      ...["a", "b", "c", "d", "e"].map((id) => ({ kind: "review" as const, wordId: id, skill: "read" as Skill })),
    ];
    const s = new Session({ queue }, 60_000);
    const served: string[] = [];
    let t: Task | null;
    while ((t = s.next(served.length * 1000))) {
      served.push(`${t.kind}:${t.wordId}`);
      s.report(t, t.kind === "review" && t.wordId === "a" && !served.includes("retry") ? { grade: 1 } : { grade: 3 });
      if (t.kind === "review" && t.wordId === "a") served.push("retry");
      if (served.length > 30) break;
    }
    expect(served[0]).toBe("intro:n");
    expect(served).toContain("review:n");
    expect(served.filter((x) => x === "review:a").length).toBe(2);

    const s2 = new Session({ queue }, 1000);
    const first = s2.next(0)!;
    s2.report(first, {});
    // Out of time: only the promised test of the introduced word remains.
    expect(s2.next(5000)).toEqual({ kind: "review", wordId: "n", skill: "read", isNew: true });
    expect(s2.next(5000)).toBeNull();
  });
});

describe("Session undo", () => {
  test("undo re-serves the previous card and reverts its follow-ups", () => {
    const queue: Task[] = [
      { kind: "intro", wordId: "n" },
      ...["a", "b", "c", "d"].map((id) => ({ kind: "review" as const, wordId: id, skill: "read" as Skill })),
    ];
    const s = new Session({ queue }, 600_000);
    const intro = s.next(0)!;
    s.report(intro, {});
    const a = s.next(0)!;
    expect(a.wordId).toBe("a");
    s.report(a, { grade: 1 }); // schedules a retry
    s.next(0); // "b" is on screen
    expect(s.undo()).toBe(true); // back to "a", retry removed
    const again = s.next(0)!;
    expect(again.wordId).toBe("a");
    s.report(again, { grade: 3 });
    const rest: string[] = [];
    let t: Task | null;
    while ((t = s.next(0))) {
      rest.push(`${t.wordId}${t.kind === "review" && t.retry ? "*" : ""}`);
      s.report(t, { grade: 3 });
    }
    expect(rest).not.toContain("a*"); // the undone failure no longer causes a retry
    expect(rest).toContain("n"); // the intro's quick check is still owed
  });

  test("nothing to undo at the start", () => {
    const s = new Session({ queue: [{ kind: "intro", wordId: "x" }] }, 1000);
    s.next(0);
    expect(s.undo()).toBe(false);
  });

  test("undo steps over a skipped card: answer a, skip l, undo brings back a", () => {
    const queue: Task[] = ["a", "l", "c"].map((id) => ({ kind: "review" as const, wordId: id, skill: (id === "l" ? "listen" : "read") as Skill }));
    const s = new Session({ queue }, 600_000);
    const a = s.next(0)!;
    s.report(a, { grade: 1 }); // answered (and its retry scheduled)
    expect(s.next(0)!.wordId).toBe("l");
    s.skip(); // "Can't listen now": no answer recorded
    expect(s.next(0)!.wordId).toBe("c");
    expect(s.undo()).toBe(true);
    expect(s.next(0)!.wordId).toBe("a"); // not "l": the answer being undone is a's
    s.report(a, { grade: 3 });
    const rest: string[] = [];
    let t: Task | null;
    while ((t = s.next(0))) {
      rest.push(`${t.wordId}${t.kind === "review" && t.retry ? "*" : ""}`);
      s.report(t, { grade: 3 });
    }
    expect(rest).toEqual(["l", "c"]); // the skipped card comes back; a's undone failure no longer retries
  });

  test("a skipped first card leaves nothing to undo", () => {
    const queue: Task[] = ["l", "c"].map((id) => ({ kind: "review" as const, wordId: id, skill: "read" as Skill }));
    const s = new Session({ queue }, 600_000);
    s.next(0);
    s.skip();
    s.next(0);
    expect(s.undo()).toBe(false);
  });
});
