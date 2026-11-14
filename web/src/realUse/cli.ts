// `bun run real-use [--json]`: the real-use report (report.ts) from the
// database at REAL_USE_DATABASE_URL. It reads ids, times, grades and counts
// only: never an email, a sign-in code or the learner's text. docs/real-use.md
// says how to get a read-only URL for production.

import { Client } from "pg";
import { indexWords, wordResolver, type LoadedDeck, type WordsPart } from "../data/deckIndex";
import type { ReviewRow } from "../data/rows";
import { courseNotes } from "../garden/notes/read";
import { report, text, type StoredCourse } from "./report";

const url = process.env.REAL_USE_DATABASE_URL;
if (!url) {
  console.error("Set REAL_USE_DATABASE_URL to the database to read. docs/real-use.md says how.");
  process.exit(1);
}

// The columns below are typed by the tables' own checks (server/migrations/0001_init.sql): grade 1–4, skill and kind from their lists.
type ReviewDb = Pick<ReviewRow, "id" | "word_id" | "skill" | "grade" | "kind" | "duration_ms"> & { user_id: string; lang: string; reviewed_at: Date; received_at: Date };

const db = new Client({ connectionString: url });
await db.connect();
// One snapshot: the reviews, courses and reads all from the same moment.
await db.query("begin isolation level repeatable read read only");
const courses = (await db.query<{ user_id: string; lang: string; retention: number; notes_read: string[] }>("select user_id, lang, retention, notes_read from course")).rows;
const reviews = (
  await db.query<ReviewDb>("select id, user_id, lang, word_id, skill, grade, kind, reviewed_at, duration_ms, received_at from review")
).rows;
const links = (await db.query<{ id: string; user_id: string; lang: string; deck_id: string }>("select id, user_id, lang, deck_id from user_word where deck_id is not null")).rows;
// The first read of each note: a learner who signed in after reading as a guest may have two (server/src/auth.ts mergeUsers).
const reads = (await db.query<{ user_id: string; lang: string; note: string; at: Date }>("select user_id, lang, note, min(at) as at from use_event where kind = 'note_read' group by 1, 2, 3")).rows;
await db.query("commit");
await db.end();

const decks = new Map<string, LoadedDeck>();
async function deck(lang: string) {
  let d = decks.get(lang);
  if (!d) {
    // A course in a language with no deck file is a bug: Bun.file throws on it.
    // CI decodes every deck with the full schema (scripts/deck/check.ts), so this trusts its shape, as sim/regenerate.ts does.
    d = indexWords((await Bun.file(new URL(`../../../decks/${lang}/deck.json`, import.meta.url)).json()) as WordsPart, lang);
    decks.set(lang, d);
  }
  return d;
}

const stored: StoredCourse[] = [];
for (const c of courses) {
  const of = <T extends { user_id: string; lang: string }>(rows: T[]) => rows.filter((r) => r.user_id === c.user_id && r.lang === c.lang);
  const linked = new Map(of(links).map((u) => [u.id, u.deck_id]));
  stored.push({
    user_id: c.user_id,
    lang: c.lang,
    retention: c.retention,
    reviews: of(reviews).map((r) => ({ ...r, reviewed_at: r.reviewed_at.toISOString(), received_at: r.received_at.toISOString() })),
    resolve: wordResolver(await deck(c.lang), linked),
    notes: courseNotes(c.lang).map((n) => ({ id: n.id, unlockAt: n.unlockAt })),
    notesRead: c.notes_read,
    noteReads: of(reads).map((r) => ({ note: r.note, at: r.at.getTime() })),
  });
}

const r = report(stored, Date.now());
console.log(process.argv.includes("--json") ? JSON.stringify(r, null, 2) : text(r));
