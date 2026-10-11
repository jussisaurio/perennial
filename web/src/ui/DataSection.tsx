import { useState } from "react";
import { db } from "../db/db";
import { deleteAccount, hostedMessage } from "../hosted/api";
import { language } from "../content/languages";
import { useAccount } from "./Account";

function download(name: string, type: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** Everything Perennial knows about you, including the full review log. */
async function exportJSON() {
  const [courses, lexemes, examples, reviews] = await Promise.all([db.courses.toArray(), db.lexemes.toArray(), db.examples.toArray(), db.reviews.toArray()]);
  const strip = <T extends { _ts?: unknown }>(rows: T[]) => rows.map(({ _ts, ...r }) => r);
  const data = { app: "perennial", version: 1, exportedAt: new Date().toISOString(), courses: strip(courses), lexemes: strip(lexemes), examples: strip(examples), reviews };
  download(`perennial-${stamp()}.json`, "application/json", JSON.stringify(data, null, 2));
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function exportCSV() {
  const [courses, lexemes, reviews] = await Promise.all([db.courses.toArray(), db.lexemes.toArray(), db.reviews.toArray()]);
  const lang = new Map(courses.map((c) => [c.id, language(c.lang).name]));
  const count = new Map<string, number>();
  for (const r of reviews) if (!r.deleted) count.set(r.lexemeId, (count.get(r.lexemeId) ?? 0) + 1);
  const rows = [["language", "word", "meaning", "part of speech", "notes", "reviews", "status"]];
  for (const l of lexemes) if (!l.deleted && l.status !== "ignored") rows.push([lang.get(l.courseId) ?? "", l.lemma, l.gloss, l.pos ?? "", l.notes ?? "", String(count.get(l.id) ?? 0), l.status ?? "active"]);
  download(`perennial-words-${stamp()}.csv`, "text/csv", rows.map((r) => r.map(csvCell).join(",")).join("\n"));
}

function DeleteAccount() {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  if (done) return <p className="small">Your account and the data on our server are deleted. Your words are still on this device.</p>;
  return (
    <details className="more danger">
      <summary>Delete my account</summary>
      <div className="form">
        <p className="small">
          This deletes your account and everything stored on our server. Your words stay on this device. <strong>You cannot undo this.</strong>
        </p>
        <label>
          Type <strong>delete</strong> to confirm
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </label>
        <div className="row">
          <button
            className="fail"
            disabled={typed.trim().toLowerCase() !== "delete"}
            onClick={() =>
              void deleteAccount()
                .then(() => setDone(true))
                .catch((e) => setError(hostedMessage(e)))
            }
          >
            Delete my account
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </details>
  );
}

export function DataSection() {
  const { signedIn } = useAccount();
  return (
    <div className="form">
      <p className="muted small">
        Your words and progress are stored in this browser. {signedIn ? "Because you are signed in, a copy is also kept on the Perennial server to sync your devices." : "Nothing leaves this device until you sign in."} When the AI makes cards, the words and sentences are sent to the AI service. Word lists come from FrequencyWords (film and TV subtitles).
      </p>
      <div className="row">
        <button className="secondary" onClick={() => void exportJSON()}>
          Download all my data (JSON)
        </button>
        <button className="secondary" onClick={() => void exportCSV()}>
          Download my words (CSV)
        </button>
      </div>
      {signedIn && <DeleteAccount />}
    </div>
  );
}
