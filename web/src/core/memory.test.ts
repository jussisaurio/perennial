import { describe, expect, test } from "bun:test";
import type { ReviewRow, Skill } from "../data/rows";
import { rng } from "../lib/seed";
import { DAY_MS } from "./day";
import { replay, type Grade } from "./fsrs";
import { deriveMemory, MemoryLog, memKey, recordGap, type MemoryRow } from "./memory";
import { fsrs } from "./scheduler";

describe("recordGap: the longest a word has waited and still been remembered", () => {
  const day = (n: number) => Date.UTC(2026, 0, 1) + n * DAY_MS;
  test("news only when the gap is two weeks or more and longer than every gap before it", () => {
    expect(recordGap([day(0), day(3), day(10)], day(33))).toBe(23); // 23 > 7 > 3
    expect(recordGap([day(0), day(30)], day(50))).toBeNull(); // 20 days, but it waited 30 before
    expect(recordGap([day(0), day(3)], day(13))).toBeNull(); // 10 days: not news yet
    expect(recordGap([], day(30))).toBeNull(); // never seen
  });
});

describe("MemoryLog: one review at a time, the same as replaying the whole log", () => {
  // The whole-log replay that MemoryLog stands in for (deriveMemory before #456), kept here as the reference.
  function fullReplay(reviews: readonly ReviewRow[], retention: number, resolve: (id: string) => string): MemoryRow[] {
    const groups = new Map<string, { wordId: string; skill: Skill; list: { ts: number; grade: Grade }[] }>();
    for (const r of reviews) {
      const wordId = resolve(r.word_id);
      const key = memKey(wordId, r.skill);
      const g = groups.get(key) ?? { wordId, skill: r.skill, list: [] };
      g.list.push({ ts: Date.parse(r.reviewed_at), grade: r.grade });
      groups.set(key, g);
    }
    const rows: MemoryRow[] = [];
    const read = new Map<string, MemoryRow>();
    for (const [key, g] of groups) {
      // A remembered listening or typing answer is a Good reading review too (#852).
      const passes = (skill: Skill) => (groups.get(memKey(g.wordId, skill))?.list ?? []).filter((e) => e.grade > 1).map((e) => ({ ...e, grade: 3 as const }));
      const list = g.skill === "read" ? [...g.list, ...passes("listen"), ...passes("write")] : g.list;
      const row: MemoryRow = { key, wordId: g.wordId, skill: g.skill, ...replay(fsrs, list, retention, key)! };
      rows.push(row);
      if (g.skill === "read") read.set(g.wordId, row);
    }
    for (const [wordId, r] of read) {
      if (r.reps < 2) continue;
      for (const [skill, s] of [["listen", 4], ["write", 10]] as const) {
        if (r.s >= s && !groups.has(memKey(wordId, skill))) rows.push({ key: memKey(wordId, skill), wordId, skill, s: 0, d: 0, lastTs: r.lastTs, due: r.lastTs, reps: 0, lapses: 0 });
      }
    }
    return rows;
  }

  // A learner's months: 150 words, some answered under an old alias, each
  // practised on a growing schedule with a few lapses, then listening and
  // writing too. In the order a device syncs them, which is not by time.
  const random = rng(7);
  const t0 = Date.UTC(2026, 0, 1, 8);
  const alias = (id: string) => (id.endsWith("-old") ? id.slice(0, -4) : id);
  const log: ReviewRow[] = [];
  for (let w = 0; w < 150; w++) {
    let t = t0 + Math.floor(random() * 60) * DAY_MS;
    let gap = 1;
    const answers = 2 + Math.floor(random() * 12);
    for (let n = 0; n < answers; n++) {
      const skill: Skill = n < 3 ? "read" : (["read", "listen", "write"] as const)[Math.floor(random() * 3)];
      const grade: Grade = random() < 0.15 ? 1 : random() < 0.1 ? 4 : 3;
      log.push({ id: `r${w}-${n}`, user_id: "u", lang: "es", word_id: random() < 0.2 ? `w${w}-old` : `w${w}`, skill, grade, kind: "review", reviewed_at: new Date(t).toISOString(), duration_ms: 3000, sentence_id: null });
      gap = grade === 1 ? 1 : gap * 2.5;
      // Now and then twice on one day.
      t += random() < 0.2 ? 3_600_000 : Math.round(gap * DAY_MS);
    }
  }
  const shuffled = log.map((r) => [random(), r] as const).sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  const sameGroup = (a: ReviewRow, b: ReviewRow) => alias(a.word_id) === alias(b.word_id) && a.skill === b.skill;

  test("adding answers one by one", () => {
    const m = new MemoryLog(0.9, alias);
    for (const r of shuffled.slice(0, 600)) m.set(r);
    expect(m.rows()).toEqual(fullReplay(shuffled.slice(0, 600), 0.9, alias));
    for (let i = 600; i < shuffled.length; i++) {
      m.set(shuffled[i]);
      // Asked after each answer, as a session does.
      expect(m.rows()).toEqual(fullReplay(shuffled.slice(0, i + 1), 0.9, alias));
    }
    expect(deriveMemory(shuffled, 0.9, alias)).toEqual(fullReplay(shuffled, 0.9, alias));
  });

  test("an answer changed, or taken back", () => {
    const m = new MemoryLog(0.9, alias);
    for (const r of shuffled) m.set(r);
    m.rows();
    // The same answer back from the server, changed: it keeps its place.
    const changed = shuffled.map((r, i) => (i === 100 ? { ...r, grade: (r.grade === 1 ? 3 : 1) as Grade } : r));
    expect(m.set(changed[100])).toBe(true);
    expect(m.rows()).toEqual(fullReplay(changed, 0.9, alias));
    // Undo: a word's newest answer goes again.
    const again = { ...changed[200], id: "again", reviewed_at: new Date(t0 + 400 * DAY_MS).toISOString() };
    m.set(again);
    expect(m.rows()).toEqual(fullReplay([...changed, again], 0.9, alias));
    expect(m.delete("again")).toBe(true);
    expect(m.rows()).toEqual(fullReplay(changed, 0.9, alias));
    // A new word's only answer goes: so does its memory.
    m.set({ ...again, id: "only", word_id: "new-word", skill: "read" });
    m.rows();
    expect(m.delete("only")).toBe(true);
    expect(m.rows()).toEqual(fullReplay(changed, 0.9, alias));
    // A word's first answer, with others after it: its place in the order would move, so the caller builds a new log.
    const first = changed.find((r) => changed.filter((x) => sameGroup(x, r)).length > 1)!;
    expect(m.delete(first.id)).toBe(false);
  });
});

describe("listening and typing count for reading (#852)", () => {
  const t0 = Date.UTC(2026, 0, 1, 8);
  const review = (n: number, skill: Skill, day: number, grade: Grade): ReviewRow => ({ id: `r${n}`, user_id: "u", lang: "es", word_id: "w", skill, grade, kind: "review", reviewed_at: new Date(t0 + day * DAY_MS).toISOString(), duration_ms: 3000, sentence_id: null });
  const reading = [review(0, "read", 0, 3), review(1, "read", 2, 3), review(2, "read", 8, 3)];
  const readRow = (reviews: ReviewRow[]) => deriveMemory(reviews, 0.9, (id) => id).find((m) => m.skill === "read")!;

  test("a remembered listening answer waters the reading memory", () => {
    const before = readRow(reading);
    const after = readRow([...reading, review(3, "listen", 20, 3)]);
    expect(after.s).toBeGreaterThan(before.s);
    expect(after.due).toBeGreaterThan(before.due);
  });

  test("a forgotten one is no reading lapse", () => {
    expect(readRow([...reading, review(3, "write", 20, 1)])).toEqual(readRow(reading));
  });
});
