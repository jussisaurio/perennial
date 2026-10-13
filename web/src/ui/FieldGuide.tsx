// The field guide (#211): the Words screen as a herbarium. Known words are
// pressed flowers on paper; words still growing are pencil sketches, so a
// flower stays a surprise until it blooms (#207). Rare flowers (#208) carry a
// small mark. A view of the same words as the list: the same search and filter.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { plantStage, type MemoryRow, type PlantStage } from "../core/memory";
import type { Word } from "../data/learner";
import { WordPlant, rareOf, type Rare } from "./plant";
import { giftLink } from "../data/gift";
import { track } from "../observability";
import { useLatinNames } from "../content/latin";

export interface GuideRow {
  l: Word;
  mem: MemoryRow[];
}

const RARE_LABEL: Record<Rare, string> = { golden: "Rare: golden", twin: "Rare: twin heads", bee: "Rare: has a bee", striped: "Rare: striped" };

const stageOf = (r: GuideRow): PlantStage => plantStage(r.mem.find((m) => m.skill === "read"));

/** The words the guide draws: started ones (a sprout or more). Words not started yet have nothing to draw. */
export function drawnRows<R extends GuideRow>(rows: readonly R[]): R[] {
  return rows.filter((r) => stageOf(r) !== "seed");
}

/** Memoised, with an id-taking onOpen, so opening one page does not redraw every plant. */
const Entry = memo(function Entry({ row, onOpen }: { row: GuideRow; onOpen: (id: string) => void }) {
  const read = row.mem.find((m) => m.skill === "read");
  const stage = plantStage(read);
  const bloomed = stage === "bloom";
  const rare = bloomed ? rareOf(row.l.lemma) : null;
  return (
    <button className={bloomed ? "guide-entry pressed" : "guide-entry sketch"} onClick={() => onOpen(row.l.id)}>
      <span aria-hidden="true">
        <WordPlant word={row.l.lemma} s={read?.reps ? read.s : 0} stage={stage} size={104} />
      </span>
      <strong>{row.l.lemma}</strong>
      <span className="gl">{row.l.gloss}</span>
      {rare && <span className="guide-rare">{RARE_LABEL[rare]}</span>}
    </button>
  );
});

type Item = { kind: "head"; title: string; note?: string } | { kind: "row"; entries: GuideRow[] };

const CARD_MIN = 136; // px: 8.5rem, as in the CSS
const GAP = 13;

/**
 * Known words first, as pressed flowers; then the words still growing.
 * Only the rows of cards near the screen are in the DOM (like the list): a
 * thousand plants are too many to draw at once on a phone.
 */
export function FieldGuide({ lang, rows, open, onOpen, detail }: { lang: string; rows: GuideRow[]; open: string | null; onOpen: (id: string | null) => void; detail: (row: GuideRow) => ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cols = Math.max(2, Math.floor((width + GAP) / (CARD_MIN + GAP)));
  const items = useMemo(() => {
    const bloomed = rows.filter((r) => stageOf(r) === "bloom");
    const growing = rows.filter((r) => stageOf(r) === "sprout" || stageOf(r) === "bud");
    const out: Item[] = [];
    const section = (title: string, list: GuideRow[], note?: string) => {
      if (!list.length) return;
      out.push({ kind: "head", title, note });
      for (let i = 0; i < list.length; i += cols) out.push({ kind: "row", entries: list.slice(i, i + cols) });
    };
    section("In bloom", bloomed);
    section("Still growing", growing, "Each one shows its flower when you know the word.");
    return out;
  }, [rows, cols]);

  const [offset, setOffset] = useState(0);
  // As in the list: banners above can appear later, so keep the offset current.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const top = (wrap.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
    if (Math.abs(top - offset) > 1) setOffset(top);
  });
  const v = useWindowVirtualizer({ count: items.length, estimateSize: (i) => (items[i].kind === "head" ? 64 : 200), overscan: 4, scrollMargin: offset });
  const onOpenId = useRef(onOpen);
  useLayoutEffect(() => {
    onOpenId.current = onOpen;
  });
  // Stable for every card, so memo(Entry) holds.
  const openCard = useMemo(() => (id: string) => onOpenId.current(id), []);
  const shown = rows.find((r) => r.l.id === open && stageOf(r) !== "seed");
  return (
    <div className="guide" ref={wrap} style={{ height: v.getTotalSize(), position: "relative" }}>
      {v.getVirtualItems().map((vi) => {
        const item = items[vi.index];
        return (
          <div key={vi.key} data-index={vi.index} ref={v.measureElement} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${vi.start - v.options.scrollMargin}px)` }}>
            {item.kind === "head" ? (
              <div className="guide-head">
                <h2>{item.title}</h2>
                {item.note && <p className="muted small">{item.note}</p>}
              </div>
            ) : (
              <div className="guide-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {item.entries.map((r) => (
                  <Entry key={r.l.id} row={r} onOpen={openCard} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {shown && <GuidePage lang={lang} row={shown} onClose={() => onOpen(null)} detail={detail(shown)} />}
    </div>
  );
}

/**
 * "Give this seed to a friend" (#213): a link that plants this word first in a
 * friend's garden. The phone's share sheet where there is one, otherwise the
 * link is copied. Only on a known word, and only when the learner chooses it.
 */
function GiveSeed({ word }: { word: Word }) {
  const [copied, setCopied] = useState(false);
  // Only deck words: a learner's own words are theirs alone, and not in a friend's deck.
  if (word.source !== "deck") return null;
  const give = async () => {
    const url = giftLink(word.id);
    const text = `I grew “${word.lemma}” in Perennial. Here is a seed for you.`;
    if (navigator.share) {
      const shared = await navigator.share({ text, url }).then(
        () => true,
        (e: unknown) => {
          // Closing the share sheet is a choice, not an error. Anything else: copy the link instead.
          if (e instanceof DOMException && e.name === "AbortError") return null;
          console.warn("[seed] share failed; copying the link instead", e);
          return false;
        },
      );
      if (shared) track("seed_shared", {});
      if (shared !== false) return;
    }
    if (!navigator.clipboard) return console.warn("[seed] no share sheet and no clipboard here");
    await navigator.clipboard.writeText(`${text} ${url}`).then(
      () => {
        setCopied(true);
        track("seed_shared", {});
      },
      (e: unknown) => console.warn("[seed] could not copy the link", e),
    );
  };
  return (
    <button className="ghost give-seed" onClick={() => void give()}>
      {copied ? "Link copied. Send it to a friend." : "Give this seed to a friend"}
    </button>
  );
}

/** One entry, opened: the plant large, and the word's details. A native dialog: Escape closes it and focus stays inside. */
function GuidePage({ lang, row, onClose, detail }: { lang: string; row: GuideRow; onClose: () => void; detail: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const read = row.mem.find((m) => m.skill === "read");
  const stage = plantStage(read);
  const rare = stage === "bloom" ? rareOf(row.l.lemma) : null;
  // A known word's botanical name (#212), when its course has one.
  const latin = useLatinNames(lang)?.[`${row.l.lemma}|${row.l.pos}`];
  return (
    // The dialog itself has no padding, so a click whose target is the dialog is on the backdrop: it closes.
    <dialog ref={ref} className="guide-page" onClose={onClose} aria-label={row.l.lemma} onClick={(e) => e.target === ref.current && ref.current?.close()}>
      <div className="guide-page-body">
        <div className={stage === "bloom" ? "guide-sheet pressed" : "guide-sheet sketch"}>
          <WordPlant word={row.l.lemma} s={read?.reps ? read.s : 0} stage={stage} size={180} />
          <h2>{row.l.lemma}</h2>
          {stage === "bloom" && latin && <p className="guide-latin">{latin}</p>}
          <p className="gl">{row.l.gloss}</p>
          {rare && <p className="guide-rare">{RARE_LABEL[rare]}</p>}
          {stage !== "bloom" && <p className="muted small">Still growing. Its flower shows when you know the word.</p>}
          {stage === "bloom" && <GiveSeed word={row.l} />}
        </div>
        {detail}
        {/* Focus starts here, not on the first control in the details. */}
        <button className="ghost guide-close" autoFocus onClick={() => ref.current?.close()}>
          Close
        </button>
      </div>
    </dialog>
  );
}
