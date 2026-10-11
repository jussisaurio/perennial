// Server-side forgetting. Sync stores a history of changes, so deleting a word
// on a device only adds a "deleted" entry; the old text stays in the history.
// Once something has been deleted for a while (long enough for Undo and for
// devices that were offline), this erases its history and keeps only a minimal
// tombstone so every device still learns it is gone.

import type { Database } from "bun:sqlite";

export const COMPACT_AFTER_MS = 30 * 86_400_000;

interface OpRow {
  seq: number;
  ns: string;
  body: string;
}

interface Op {
  id: string;
  hlc: string;
  table: string;
  rowId: string;
  patch: Record<string, unknown>;
}

const hlcMs = (hlc: string) => Number(hlc.slice(0, 13));

export function compact(db: Database, now = Date.now(), olderThanMs = COMPACT_AFTER_MS): { rows: number; ops: number } {
  const cutoff = now - olderThanMs;
  let rows = 0;
  let removed = 0;
  // Latest state of each row's `deleted` field, per namespace.
  const tombstones = db
    .query<OpRow, []>("SELECT seq, ns, body FROM ops WHERE json_extract(body, '$.patch.deleted') IS NOT NULL ORDER BY seq")
    .all();
  const latest = new Map<string, { seq: number; ns: string; op: Op }>();
  for (const r of tombstones) {
    const op = JSON.parse(r.body) as Op;
    latest.set(`${r.ns}|${op.table}|${op.rowId}`, { seq: r.seq, ns: r.ns, op });
  }
  const del = db.prepare("DELETE FROM ops WHERE seq = ?");
  const all = db.prepare<OpRow, { ns: string }>("SELECT seq, ns, body FROM ops WHERE ns = $ns ORDER BY seq");
  const minimal = db.prepare("UPDATE ops SET body = ? WHERE seq = ?");

  const run = db.transaction(() => {
    const byNs = new Map<string, { table: string; rowId: string; seq: number; op: Op }[]>();
    for (const t of latest.values()) {
      if (!t.op.patch.deleted || hlcMs(t.op.hlc) > cutoff) continue; // undone, or too recent
      const list = byNs.get(t.ns) ?? [];
      list.push({ table: t.op.table, rowId: t.op.rowId, seq: t.seq, op: t.op });
      byNs.set(t.ns, list);
    }
    for (const [ns, dead] of byNs) {
      const ops = all.all({ ns }).map((r) => ({ seq: r.seq, op: JSON.parse(r.body) as Op }));
      // Deleting a course takes its words with it; deleting a word takes its
      // sentences and reviews with it.
      const gone = new Set(dead.map((d) => `${d.table}|${d.rowId}`));
      const deadCourses = new Set(dead.filter((d) => d.table === "courses").map((d) => d.rowId));
      const deadWords = new Set(dead.filter((d) => d.table === "lexemes").map((d) => d.rowId));
      for (const { op } of ops) {
        const p = op.patch;
        if (op.table === "lexemes" && deadCourses.has(p.courseId as string)) deadWords.add(op.rowId);
      }
      for (const { op } of ops) {
        const p = op.patch;
        if ((op.table === "examples" || op.table === "reviews") && (deadWords.has(p.lexemeId as string) || deadCourses.has(p.courseId as string))) gone.add(`${op.table}|${op.rowId}`);
        if (op.table === "lexemes" && deadWords.has(op.rowId)) gone.add(`lexemes|${op.rowId}`);
      }
      const keep = new Map(dead.map((d) => [`${d.table}|${d.rowId}`, d.seq]));
      for (const { seq, op } of ops) {
        const key = `${op.table}|${op.rowId}`;
        if (!gone.has(key)) continue;
        const tomb = keep.get(key);
        if (tomb === seq) {
          // Keep a minimal tombstone (only the deletion) so devices drop the row.
          minimal.run(JSON.stringify({ id: op.id, hlc: op.hlc, table: op.table, rowId: op.rowId, patch: { deleted: op.patch.deleted } }), seq);
          continue;
        }
        del.run(seq);
        removed++;
      }
      rows += gone.size;
    }
  });
  run();
  return { rows, ops: removed };
}
