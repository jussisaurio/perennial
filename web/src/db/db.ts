import Dexie, { type EntityTable } from "dexie";
import { FSRS, replay } from "../core/fsrs";
import { HLC } from "../core/hlc";
import type { FreqEntry } from "../content/text";
import { memKey, SKILLS, type Course, type Example, type Lexeme, type MemoryRow, type Review, type Skill } from "../model";

export type SyncedTable = "courses" | "lexemes" | "examples" | "reviews";

export interface Op {
  id: string;
  hlc: string;
  table: SyncedTable;
  rowId: string;
  patch: Record<string, unknown>;
  sent: 0 | 1;
}

interface Meta {
  k: string;
  v: unknown;
}

interface FreqList {
  lang: string;
  entries: FreqEntry[];
}

class PerennialDB extends Dexie {
  courses!: EntityTable<Course, "id">;
  lexemes!: EntityTable<Lexeme, "id">;
  examples!: EntityTable<Example, "id">;
  reviews!: EntityTable<Review, "id">;
  memory!: EntityTable<MemoryRow, "key">;
  ops!: EntityTable<Op, "id">;
  freq!: EntityTable<FreqList, "lang">;
  meta!: EntityTable<Meta, "k">;

  constructor(name = "perennial") {
    super(name);
    this.version(1).stores({
      courses: "id",
      lexemes: "id, courseId, [courseId+rank]",
      examples: "id, lexemeId, courseId",
      reviews: "id, courseId, lexemeId, ts",
      memory: "key, courseId, lexemeId",
      ops: "id, sent",
      freq: "lang",
      meta: "k",
    });
  }
}

export const db = new PerennialDB();

export const uid = () => crypto.randomUUID();

/** Stable id so two devices generating the same word produce the same row. */
export async function stableId(...parts: string[]): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\u001f")));
  return [...new Uint8Array(buf).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getMeta<T>(k: string, fallback: T): Promise<T> {
  const row = await db.meta.get(k);
  return row ? (row.v as T) : fallback;
}

export const setMeta = (k: string, v: unknown) => db.meta.put({ k, v });

let hlc: HLC | null = null;
export async function clock(): Promise<HLC> {
  if (!hlc) {
    let device = await getMeta<string | null>("device", null);
    if (!device) {
      device = uid().slice(0, 8);
      await setMeta("device", device);
    }
    hlc = new HLC(device);
  }
  return hlc;
}

let onLocalChange: () => void = () => {};
export const setLocalChangeListener = (fn: () => void) => (onLocalChange = fn);

const tableOf = (t: SyncedTable) => db.table(t);

/**
 * Write fields to a synced row and record the change in the op log. Every
 * local mutation of synced data goes through here.
 */
export async function write<T extends { id: string }>(table: SyncedTable, row: Partial<T> & { id: string }): Promise<void> {
  const stamp = (await clock()).now();
  const { id, ...fields } = row;
  delete (fields as Record<string, unknown>)._ts;
  await db.transaction("rw", [tableOf(table), db.ops], async () => {
    const existing = (await tableOf(table).get(id)) as (Record<string, unknown> & { _ts?: Record<string, string> }) | undefined;
    const ts = { ...(existing?._ts ?? {}) };
    for (const k of Object.keys(fields)) ts[k] = stamp;
    await tableOf(table).put({ ...(existing ?? {}), ...fields, id, _ts: ts });
    await db.ops.add({ id: uid(), hlc: stamp, table, rowId: id, patch: fields, sent: 0 });
  });
  onLocalChange();
}

export async function writeMany<T extends { id: string }>(table: SyncedTable, rows: (Partial<T> & { id: string })[]): Promise<void> {
  const c = await clock();
  await db.transaction("rw", [tableOf(table), db.ops], async () => {
    const existing = await tableOf(table).bulkGet(rows.map((r) => r.id));
    const puts: unknown[] = [];
    const ops: Op[] = [];
    rows.forEach((row, i) => {
      const stamp = c.now();
      const { id, ...fields } = row;
      delete (fields as Record<string, unknown>)._ts;
      const prev = existing[i] as (Record<string, unknown> & { _ts?: Record<string, string> }) | undefined;
      const ts = { ...(prev?._ts ?? {}) };
      for (const k of Object.keys(fields)) ts[k] = stamp;
      puts.push({ ...(prev ?? {}), ...fields, id, _ts: ts });
      ops.push({ id: uid(), hlc: stamp, table, rowId: id, patch: fields, sent: 0 });
    });
    await tableOf(table).bulkPut(puts);
    await db.ops.bulkAdd(ops);
  });
  onLocalChange();
}

/** Apply ops from another device. Returns lexemes and courses whose derived scheduling state must be rebuilt. */
export async function applyRemote(ops: Omit<Op, "sent">[]): Promise<{ lexemes: Set<string>; courses: Set<string> }> {
  const c = await clock();
  const touched = new Set<string>();
  const courses = new Set<string>();
  const tables = (["courses", "lexemes", "examples", "reviews"] as const).map(tableOf);
  await db.transaction("rw", [...tables, db.ops], async () => {
    for (const op of ops) {
      c.observe(op.hlc);
      if (await db.ops.get(op.id)) continue;
      await db.ops.add({ ...op, sent: 1 });
      const t = tableOf(op.table);
      const existing = (await t.get(op.rowId)) as (Record<string, unknown> & { _ts?: Record<string, string> }) | undefined;
      if (op.table === "reviews") {
        // Append-only, except for an Undo tombstone.
        if (!existing) {
          await t.put({ ...op.patch, id: op.rowId });
          touched.add(op.patch.lexemeId as string);
        } else if (op.patch.deleted && !existing.deleted) {
          await t.put({ ...existing, deleted: op.patch.deleted });
          touched.add(existing.lexemeId as string);
        }
        continue;
      }
      const ts = { ...(existing?._ts ?? {}) };
      const next: Record<string, unknown> = { ...(existing ?? {}), id: op.rowId };
      for (const [k, v] of Object.entries(op.patch)) {
        if (!ts[k] || ts[k] < op.hlc) {
          next[k] = v;
          ts[k] = op.hlc;
        }
      }
      await t.put({ ...next, _ts: ts });
      if (op.table === "lexemes") touched.add(op.rowId); // its reviews may have arrived first
      if (op.table === "courses" && "retention" in op.patch) courses.add(op.rowId);
    }
  });
  return { lexemes: touched, courses };
}

// ---------------------------------------------------------------------------
// Scheduling state, derived from the review log.

const fsrs = new FSRS();
export const scheduler = fsrs;

/** Thresholds (stability in days on "read") for unlocking harder skills. */
const UNLOCK: Record<Exclude<Skill, "read">, number> = { listen: 4, write: 10 };

export async function recompute(lexemeId: string): Promise<void> {
  const lex = await db.lexemes.get(lexemeId);
  if (!lex) return;
  const course = await db.courses.get(lex.courseId);
  const retention = course?.retention ?? 0.9;
  const reviews = (await db.reviews.where("lexemeId").equals(lexemeId).toArray()).filter((r) => !r.deleted);
  const rows: MemoryRow[] = [];
  for (const skill of SKILLS) {
    const st = replay(
      fsrs,
      reviews.filter((r) => r.skill === skill),
      retention,
      memKey(lexemeId, skill),
    );
    if (st) rows.push({ key: memKey(lexemeId, skill), courseId: lex.courseId, lexemeId, skill, ...st });
  }
  const read = rows.find((r) => r.skill === "read");
  // Harder skills unlock once reading is genuinely established, not after one lucky review.
  if (read && read.reps >= 2) {
    for (const skill of ["listen", "write"] as const) {
      if (read.s >= UNLOCK[skill] && !rows.some((r) => r.skill === skill)) {
        rows.push({ key: memKey(lexemeId, skill), courseId: lex.courseId, lexemeId, skill, s: 0, d: 0, lastTs: read.lastTs, due: read.lastTs, reps: 0, lapses: 0 });
      }
    }
  }
  await db.transaction("rw", db.memory, async () => {
    await db.memory.where("lexemeId").equals(lexemeId).delete();
    await db.memory.bulkPut(rows);
  });
}

export async function recomputeCourse(courseId: string): Promise<void> {
  const ids = await db.lexemes.where("courseId").equals(courseId).primaryKeys();
  for (const id of ids) await recompute(id);
}

export async function addReview(r: Omit<Review, "id">): Promise<string> {
  const id = uid();
  await write<Review>("reviews", { id, ...r });
  await recompute(r.lexemeId);
  return id;
}

export async function undoReview(id: string): Promise<void> {
  const r = await db.reviews.get(id);
  if (!r) return;
  await write<Review>("reviews", { id, deleted: Date.now() });
  await recompute(r.lexemeId);
}
