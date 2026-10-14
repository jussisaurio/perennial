import { useState } from "react";
import { useFeatures } from "../data/server";
import { deleteAccount, useUser } from "../data/auth";
import { readMemory, wordState } from "../core/memory";
import { useLearner, type Learner } from "../data/learner";
import { language } from "../content/languages";
import { download } from "./files";
import { plural } from "./format";

const stamp = () => new Date().toISOString().slice(0, 10);

/** Everything Perennial keeps about you for this language, including the full review log. */
function exportJSON(l: Learner): string {
  const words = l.studied.map((w) => ({ ...w, sentences: l.sentences(w.id) }));
  const data = { app: "perennial", version: 2, exportedAt: new Date().toISOString(), language: l.lang, course: l.course, words, reviews: l.reviews, wordStates: [...l.states.values()] };
  const name = `perennial-${l.lang}-${stamp()}.json`;
  download(name, new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  return `Downloading all your data as ${name}. Look for it in your downloads.`;
}

const csvCell = (v: unknown) => {
  let s = v === undefined || v === null ? "" : String(v);
  // A spreadsheet would run a cell that starts like a formula; a leading quote keeps it text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function exportCSV(l: Learner): string {
  const rows = [["language", "word", "meaning", "part of speech", "notes", "reviews", "state", "status"]];
  for (const w of l.studied) {
    if (w.status === "ignored") continue;
    rows.push([language(l.lang).name, w.lemma, w.gloss, w.pos ?? "", w.notes ?? "", String(l.reviewsByWord.get(w.id)?.length ?? 0), wordState(readMemory(l, w.id)), w.status]);
  }
  const name = `perennial-words-${l.lang}-${stamp()}.csv`;
  download(name, new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" }));
  return `Downloading ${plural(rows.length - 1, "word")} as ${name}. Look for it in your downloads.`;
}

function DeleteAccount({ lang }: { lang: string }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  return (
    <details className="more danger">
      <summary>Delete my account</summary>
      <div className="form">
        <p className="small">
          This deletes your account, your garden and everything stored on our server. <strong>You cannot undo this.</strong> Download your data first if you want to keep a copy.
        </p>
        <label>
          Type <strong>delete</strong> to confirm
          <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </label>
        <div className="row">
          <button className="fail" disabled={typed.trim().toLowerCase() !== "delete"} onClick={() => void deleteAccount(lang).catch((e) => setError(e instanceof Error ? e.message : String(e)))}>
            Delete my account
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>
    </details>
  );
}

export function DataSection({ lang }: { lang: string }) {
  const { user } = useUser();
  const { ai } = useFeatures();
  const learner = useLearner(lang);
  // A download can start without a sign on the page: say that it did (#272).
  const [saved, setSaved] = useState("");
  return (
    <div className="form">
      <p className="muted small">
        Your progress is saved on the Perennial server, so you can continue on any device {user?.anonymous ? "after you add your email" : "where you sign in"}.{ai && " When Perennial AI makes cards for you, those words and sentences are sent to the AI service (Anthropic)."} See the{" "}
        <a href="/privacy.html">privacy policy</a>.
      </p>
      <div className="row">
        <button className="secondary" disabled={!learner} onClick={() => learner && setSaved(exportJSON(learner))}>
          Download all my data (JSON)
        </button>
        <button className="secondary" disabled={!learner} onClick={() => learner && setSaved(exportCSV(learner))}>
          Download my words (CSV)
        </button>
      </div>
      <p className="muted small" role="status">
        {saved}
      </p>
      {user && <DeleteAccount lang={lang} />}
    </div>
  );
}
