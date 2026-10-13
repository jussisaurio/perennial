// The field guide (#211): the Words screen as a herbarium. Known words are
// pressed flowers on paper; words still growing are pencil sketches, so a
// flower stays a surprise until it blooms (#207). Rare flowers (#208) carry a
// small mark. A view of the same words as the list: the same search and filter.

import { useEffect, useRef, type ReactNode } from "react";
import { plantStage, type MemoryRow } from "../core/memory";
import type { Word } from "../data/learner";
import { WordPlant, rareOf, type Rare } from "./plant";

export interface GuideRow {
  l: Word;
  mem: MemoryRow[];
}

const RARE_LABEL: Record<Rare, string> = { golden: "Rare: golden", twin: "Rare: twin heads", bee: "Rare: has a bee", striped: "Rare: striped" };

function Entry({ row, onOpen }: { row: GuideRow; onOpen: () => void }) {
  const read = row.mem.find((m) => m.skill === "read");
  const stage = plantStage(read);
  const bloomed = stage === "bloom";
  const rare = bloomed ? rareOf(row.l.lemma) : null;
  return (
    <button className={bloomed ? "guide-entry pressed" : "guide-entry sketch"} onClick={onOpen}>
      <WordPlant word={row.l.lemma} s={read?.reps ? read.s : 0} stage={stage} size={104} />
      <strong>{row.l.lemma}</strong>
      <span className="gl">{row.l.gloss}</span>
      {rare && <span className="guide-rare">{RARE_LABEL[rare]}</span>}
    </button>
  );
}

/** Known words first, as pressed flowers; then the words still growing. Words not started yet are not drawn. */
export function FieldGuide({ rows, open, onOpen, detail }: { rows: GuideRow[]; open: string | null; onOpen: (id: string | null) => void; detail: (row: GuideRow) => ReactNode }) {
  const bloomed = rows.filter((r) => plantStage(r.mem.find((m) => m.skill === "read")) === "bloom");
  const growing = rows.filter((r) => {
    const st = plantStage(r.mem.find((m) => m.skill === "read"));
    return st === "sprout" || st === "bud";
  });
  const shown = rows.find((r) => r.l.id === open);
  return (
    <div className="guide">
      {bloomed.length > 0 && (
        <section>
          <h2>In bloom</h2>
          <div className="guide-grid">
            {bloomed.map((r) => (
              <Entry key={r.l.id} row={r} onOpen={() => onOpen(r.l.id)} />
            ))}
          </div>
        </section>
      )}
      {growing.length > 0 && (
        <section>
          <h2>Still growing</h2>
          <p className="muted small">Each one shows its flower when you know the word.</p>
          <div className="guide-grid">
            {growing.map((r) => (
              <Entry key={r.l.id} row={r} onOpen={() => onOpen(r.l.id)} />
            ))}
          </div>
        </section>
      )}
      {shown && <GuidePage row={shown} onClose={() => onOpen(null)} detail={detail(shown)} />}
    </div>
  );
}

/** One entry, opened: the plant large, and the word's details. A native dialog: Escape closes it and focus stays inside. */
function GuidePage({ row, onClose, detail }: { row: GuideRow; onClose: () => void; detail: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const read = row.mem.find((m) => m.skill === "read");
  const stage = plantStage(read);
  const rare = stage === "bloom" ? rareOf(row.l.lemma) : null;
  return (
    <dialog ref={ref} className="guide-page" onClose={onClose} aria-label={row.l.lemma} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <div className={stage === "bloom" ? "guide-sheet pressed" : "guide-sheet sketch"}>
        <WordPlant word={row.l.lemma} s={read?.reps ? read.s : 0} stage={stage} size={180} />
        <h2>{row.l.lemma}</h2>
        <p className="gl">{row.l.gloss}</p>
        {rare && <p className="guide-rare">{RARE_LABEL[rare]}</p>}
        {stage !== "bloom" && <p className="muted small">Still growing. Its flower shows when you know the word.</p>}
      </div>
      {detail}
      <button className="ghost guide-close" onClick={() => ref.current?.close()}>
        Close
      </button>
    </dialog>
  );
}
