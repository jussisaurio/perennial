// A word's plant stage as a small glyph for lists: the same stage the gardens
// show (plantStage), so a word blooms in the list exactly when it blooms there.

import { plantStage } from "../core/memory";
import { stageLabel } from "../garden/plants";

// The five petals as one path: each SVG element costs style, layout and paint
// on every list row that scrolls in, and five ellipses made bloom rows the
// heaviest (perf/ui.ts). Each petal is an ellipse (rx 2, ry 3.6) whose centre
// sits 3.4 above the flower's centre (12, 8), turned by its angle.
const PETALS = [0, 72, 144, 216, 288]
  .map((a) => {
    const r = (a * Math.PI) / 180;
    // The petal's two tips: 3.4 ∓ 3.6 above the centre, turned by a.
    const tip = (y: number) => `${(12 - y * Math.sin(r)).toFixed(2)} ${(8 + y * Math.cos(r)).toFixed(2)}`;
    return `M${tip(-7)}A2 3.6 ${a} 0 1 ${tip(0.2)}A2 3.6 ${a} 0 1 ${tip(-7)}Z`;
  })
  .join("");

/** Small per-word status glyph for lists. */
export function StageGlyph({ s, reps, suspended }: { s: number; reps: number; suspended?: boolean }) {
  const stage = suspended ? "suspended" : plantStage({ s, reps });
  return (
    <svg className="glyph" viewBox="0 0 24 24" role="img" aria-label={stage === "suspended" ? "paused" : stageLabel(stage)}>
      {stage === "seed" && (
        <>
          <path d="M5 19.5h14" stroke="var(--soil-2)" strokeWidth="2" strokeLinecap="round" />
          <ellipse cx="12" cy="16.5" rx="3.4" ry="2.4" fill="var(--sun)" opacity="0.85" />
        </>
      )}
      {stage === "suspended" && (
        <path d="M9.5 8v8M14.5 8v8" stroke="var(--muted)" strokeWidth="2.2" strokeLinecap="round" />
      )}
      {(stage === "sprout" || stage === "bud" || stage === "bloom") && <path d="M12 21v-10" stroke="var(--stem)" strokeWidth="1.8" strokeLinecap="round" />}
      {stage === "sprout" && <path d="M12 12c0-3 2.5-5 5.5-5 0 3-2.5 5-5.5 5zM12 13c0-2.6-2-4.3-4.6-4.3 0 2.6 2 4.3 4.6 4.3z" fill="var(--leaf-2)" />}
      {/* Green like a closed bud in the garden: the colour comes with the bloom (#207). */}
      {stage === "bud" && <ellipse cx="12" cy="8" rx="3.4" ry="4.6" fill="var(--leaf-2)" stroke="var(--stem)" strokeWidth="0.8" />}
      {stage === "bloom" && (
        <>
          <path d={PETALS} fill="var(--petal-1)" />
          <circle cx="12" cy="8" r="2.2" fill="var(--sun)" />
        </>
      )}
    </svg>
  );
}
