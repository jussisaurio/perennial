import { describe, expect, test } from "bun:test";
import { DAY_MS, FSRS } from "./fsrs";
import { plan, Session, type Task } from "./session";
import type { MemoryRow } from "../data/learner";
import type { Skill } from "../data/rows";

const fsrs = new FSRS();
const now = Date.UTC(2026, 5, 1);

function mem(id: string, skill: Skill, daysAgo: number, s: number): MemoryRow {
  const lastTs = now - daysAgo * DAY_MS;
  return { key: `${id}:${skill}`, courseId: "c", lexemeId: id, skill, s, d: 5, lastTs, due: lastTs + s * DAY_MS, reps: 3, lapses: 0 };
}

describe("plan", () => {
  test("fresh learner gets only new words, capped", () => {
    const p = plan({ now, budgetMs: 7 * 60_000, memories: [], fresh: ["a", "b", "c"], fsrs });
    expect(p.newCount).toBe(3);
    expect(p.queue.every((t) => t.kind === "intro")).toBe(true);
  });

  test("the new-word limit is per day and the plan says when it is the reason", () => {
    const fresh = Array.from({ length: 40 }, (_, i) => `f${i}`);
    const first = plan({ now, budgetMs: 7 * 60_000, memories: [], fresh, fsrs, newToday: 0 });
    expect(first.newCount).toBe(15);
    expect(first.newLimitReached).toBe(true);
    const again = plan({ now, budgetMs: 5 * 60_000, memories: [], fresh, fsrs, newToday: 15 });
    expect(again.newCount).toBe(0);
    expect(again.newLimitReached).toBe(true);
  });

  test("triage: overdue items with higher retrievability come first", () => {
    const memories = [mem("gone", "read", 60, 2), mem("fresh", "read", 11, 10), mem("mid", "read", 20, 10)];
    const p = plan({ now, budgetMs: 60_000, memories, fresh: [], fsrs });
    expect(p.queue.map((t) => t.lexemeId)).toEqual(["fresh", "mid", "gone"]);
  });

  test("not-yet-due items are skipped", () => {
    const p = plan({ now, budgetMs: 60_000, memories: [mem("later", "read", 1, 30)], fresh: [], fsrs });
    expect(p.queue).toHaveLength(0);
  });

  test("one skill per word per session", () => {
    const memories = [mem("a", "read", 10, 5), mem("a", "write", 10, 3)];
    const p = plan({ now, budgetMs: 60_000, memories, fresh: [], fsrs });
    expect(p.queue).toEqual([{ kind: "review", lexemeId: "a", skill: "write" }]);
  });

  test("never-practised skills trickle in after real reviews, never ahead of them", () => {
    const fresh = (id: string, skill: Skill): MemoryRow => ({ ...mem(id, skill, 0, 0), reps: 0, due: now - 1 });
    const memories = [
      ...Array.from({ length: 10 }, (_, i) => fresh(`n${i}`, "listen")),
      mem("slipping", "read", 20, 5),
      fresh("w", "write"),
    ];
    const p = plan({ now, budgetMs: 7 * 60_000, memories, fresh: [], fsrs });
    expect(p.queue[0]).toEqual({ kind: "review", lexemeId: "slipping", skill: "read" });
    const newSkills = p.queue.filter((t) => t.kind === "review" && t.isNew);
    expect(newSkills.length).toBeLessThanOrEqual(4);
    expect(newSkills.length).toBeGreaterThan(0);
  });

  test("writing gets its turn: a new skill is offered when the word has nothing else due", () => {
    const memories = [mem("a", "read", 1, 30), { ...mem("a", "write", 0, 0), reps: 0, due: now - 1 }];
    const p = plan({ now, budgetMs: 7 * 60_000, memories, fresh: [], fsrs });
    expect(p.queue).toEqual([{ kind: "review", lexemeId: "a", skill: "write", isNew: true }]);
  });

  test("huge backlog: no new words; moderate backlog: a trickle", () => {
    const many = Array.from({ length: 200 }, (_, i) => mem(`w${i}`, "read", 30, 5));
    expect(plan({ now, budgetMs: 7 * 60_000, memories: many, fresh: ["n1", "n2"], fsrs }).newCount).toBe(0);
    const some = many.slice(0, 60); // ~8 min of reviews in a 7 min session
    expect(plan({ now, budgetMs: 7 * 60_000, memories: some, fresh: ["n1", "n2"], fsrs }).newCount).toBe(2);
  });
});

describe("Session", () => {
  test("intro gets a follow-up test; failures retry; time-up drains follow-ups only", () => {
    const queue: Task[] = [
      { kind: "intro", lexemeId: "n" },
      ...["a", "b", "c", "d", "e"].map((id) => ({ kind: "review" as const, lexemeId: id, skill: "read" as Skill })),
    ];
    const s = new Session({ queue, dueCount: 5, newCount: 1, newLimitReached: false }, 60_000);
    const served: string[] = [];
    let t: Task | null;
    while ((t = s.next(served.length * 1000))) {
      served.push(`${t.kind}:${t.lexemeId}`);
      s.report(t, t.kind === "review" && t.lexemeId === "a" && !served.includes("retry") ? { grade: 1 } : { grade: 3 });
      if (t.kind === "review" && t.lexemeId === "a") served.push("retry");
      if (served.length > 30) break;
    }
    expect(served[0]).toBe("intro:n");
    expect(served).toContain("review:n");
    expect(served.filter((x) => x === "review:a").length).toBe(2);

    const s2 = new Session({ queue, dueCount: 5, newCount: 1, newLimitReached: false }, 1000);
    const first = s2.next(0)!;
    s2.report(first, {});
    // Out of time: only the promised test of the introduced word remains.
    expect(s2.next(5000)).toEqual({ kind: "review", lexemeId: "n", skill: "read", isNew: true });
    expect(s2.next(5000)).toBeNull();
  });
});

describe("Session undo", () => {
  test("undo re-serves the previous card and reverts its follow-ups", () => {
    const queue: Task[] = [
      { kind: "intro", lexemeId: "n" },
      ...["a", "b", "c", "d"].map((id) => ({ kind: "review" as const, lexemeId: id, skill: "read" as Skill })),
    ];
    const s = new Session({ queue, dueCount: 4, newCount: 1, newLimitReached: false }, 600_000);
    const intro = s.next(0)!;
    s.report(intro, {});
    const a = s.next(0)!;
    expect(a.lexemeId).toBe("a");
    s.report(a, { grade: 1 }); // schedules a retry
    s.next(0); // "b" is on screen
    expect(s.undo()).toBe(true); // back to "a", retry removed
    const again = s.next(0)!;
    expect(again.lexemeId).toBe("a");
    s.report(again, { grade: 3 });
    const rest: string[] = [];
    let t: Task | null;
    while ((t = s.next(0))) {
      rest.push(`${t.lexemeId}${t.kind === "review" && t.retry ? "*" : ""}`);
      s.report(t, { grade: 3 });
    }
    expect(rest).not.toContain("a*"); // the undone failure no longer causes a retry
    expect(rest).toContain("n"); // the intro's quick check is still owed
  });

  test("nothing to undo at the start", () => {
    const s = new Session({ queue: [{ kind: "intro", lexemeId: "x" }], dueCount: 0, newCount: 1, newLimitReached: false }, 1000);
    s.next(0);
    expect(s.undo()).toBe(false);
  });

  test("undo steps over a skipped card: answer a, skip l, undo brings back a", () => {
    const queue: Task[] = ["a", "l", "c"].map((id) => ({ kind: "review" as const, lexemeId: id, skill: (id === "l" ? "listen" : "read") as Skill }));
    const s = new Session({ queue, dueCount: 3, newCount: 0, newLimitReached: false }, 600_000);
    const a = s.next(0)!;
    s.report(a, { grade: 1 }); // answered (and its retry scheduled)
    expect(s.next(0)!.lexemeId).toBe("l");
    s.skip(); // "Can't listen now": no answer recorded
    expect(s.next(0)!.lexemeId).toBe("c");
    expect(s.undo()).toBe(true);
    expect(s.next(0)!.lexemeId).toBe("a"); // not "l": the answer being undone is a's
    s.report(a, { grade: 3 });
    const rest: string[] = [];
    let t: Task | null;
    while ((t = s.next(0))) {
      rest.push(`${t.lexemeId}${t.kind === "review" && t.retry ? "*" : ""}`);
      s.report(t, { grade: 3 });
    }
    expect(rest).toEqual(["l", "c"]); // the skipped card comes back; a's undone failure no longer retries
  });

  test("a skipped first card leaves nothing to undo", () => {
    const queue: Task[] = ["l", "c"].map((id) => ({ kind: "review" as const, lexemeId: id, skill: "read" as Skill }));
    const s = new Session({ queue, dueCount: 2, newCount: 0, newLimitReached: false }, 600_000);
    s.next(0);
    s.skip();
    s.next(0);
    expect(s.undo()).toBe(false);
  });
});
