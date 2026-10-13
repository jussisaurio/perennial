// A word's plant stage as a small glyph for lists: the same stage the gardens
// show (plantStage), so a word blooms in the list exactly when it blooms there.

import { plantStage } from "../core/memory";
import { stageLabel } from "../garden/plants";

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
        <g stroke="var(--muted)" strokeWidth="2.2" strokeLinecap="round">
          <path d="M9.5 8v8M14.5 8v8" />
        </g>
      )}
      {(stage === "sprout" || stage === "bud" || stage === "bloom") && <path d="M12 21v-10" stroke="var(--stem)" strokeWidth="1.8" strokeLinecap="round" />}
      {stage === "sprout" && (
        <>
          <path d="M12 12c0-3 2.5-5 5.5-5 0 3-2.5 5-5.5 5z" fill="var(--leaf-2)" />
          <path d="M12 13c0-2.6-2-4.3-4.6-4.3 0 2.6 2 4.3 4.6 4.3z" fill="var(--leaf-2)" />
        </>
      )}
      {/* Green like a closed bud in the garden: the colour comes with the bloom (#207). */}
      {stage === "bud" && <ellipse cx="12" cy="8" rx="3.4" ry="4.6" fill="var(--leaf-2)" stroke="var(--stem)" strokeWidth="0.8" />}
      {stage === "bloom" && (
        <g transform="translate(12 8)">
          {[0, 72, 144, 216, 288].map((a) => (
            <ellipse key={a} rx="2" ry="3.6" fill="var(--petal-1)" transform={`rotate(${a}) translate(0 -3.4)`} />
          ))}
          <circle r="2.2" fill="var(--sun)" />
        </g>
      )}
    </svg>
  );
}
