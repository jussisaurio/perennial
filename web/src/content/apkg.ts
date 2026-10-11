// Import notes from an Anki .apkg/.colpkg. Content only: the first field
// becomes the word, the second its meaning. Review history and media are not
// imported — FSRS starts fresh, and audio comes from speech synthesis.

import { unzipSync } from "fflate";
import { decompress } from "fzstd";
import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { db, stableId, writeMany } from "../db/db";
import type { Course, Lexeme } from "../model";
import { formKey } from "./text";

export function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html.replace(/\[sound:[^\]]*\]/g, "").replace(/<br\s*\/?>/gi, "; "), "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").replace(/^[;\s]+|[;\s]+$/g, "").trim();
}

export interface ApkgPreview {
  notes: { front: string; back: string; tags: string }[];
}

export async function readApkg(file: File): Promise<ApkgPreview> {
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  let bytes: Uint8Array | undefined;
  if (files["collection.anki21b"]) bytes = decompress(files["collection.anki21b"]);
  else bytes = files["collection.anki21"] ?? files["collection.anki2"];
  if (!bytes) throw new Error("Not an Anki package: no collection inside.");

  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const sdb = new SQL.Database(bytes);
  try {
    const rows = sdb.exec("SELECT flds, tags FROM notes ORDER BY id")[0]?.values ?? [];
    const notes = rows
      .map(([flds, tags]) => {
        const fields = String(flds).split("\x1f");
        return { front: stripHtml(fields[0] ?? ""), back: stripHtml(fields[1] ?? ""), tags: String(tags).trim() };
      })
      .filter((n) => n.front && n.back);
    return { notes };
  } finally {
    sdb.close();
  }
}

/** Notes whose word is already in the course (and would collide with it). */
export async function existingNotes(course: Course, notes: ApkgPreview["notes"]): Promise<Set<number>> {
  const ids = await Promise.all(notes.map((n) => stableId(course.id, formKey(n.front))));
  const found = await db.lexemes.bulkGet(ids);
  return new Set(found.flatMap((l, i) => (l && !l.deleted ? [i] : [])));
}

/** Adds new words only: words already in the course keep their meaning and history. */
export async function importNotes(course: Course, notes: ApkgPreview["notes"]): Promise<{ added: number; skipped: number }> {
  const now = Date.now();
  const skip = await existingNotes(course, notes);
  const rows: Lexeme[] = [];
  for (const [i, n] of notes.entries()) {
    if (skip.has(i)) continue;
    rows.push({
      id: await stableId(course.id, formKey(n.front)),
      courseId: course.id,
      lemma: n.front,
      gloss: n.back,
      forms: [formKey(n.front)],
      // Anki tags are for sorting decks, not notes a learner should read.
      notes: undefined,
      addedAt: now,
      picked: now + i, // keep the deck's order
      status: "active",
      deleted: 0,
    });
  }
  for (let i = 0; i < rows.length; i += 500) await writeMany("lexemes", rows.slice(i, i + 500));
  return { added: rows.length, skipped: skip.size };
}
