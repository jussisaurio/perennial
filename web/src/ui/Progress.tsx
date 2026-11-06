import { useMemo } from "react";
import { language } from "../content/languages";
import { restDayLine } from "../content/voice";
import { today } from "../core/day";
import { KNOWN_RULE } from "../core/memory";
import { type Learner } from "../data/learner";
import { readableCount } from "../data/reading";
import { plural } from "./format";
import { courseStats } from "./stats";
import { useNow } from "./useNow";

/** How the course is going, on the Words page: open, not behind "More progress". Today keeps only the day's action. */
export function Progress({ learner, lang: code }: { learner: Learner; lang: string }) {
  const now = useNow();
  const day = today(new Date(now));
  const stats = useMemo(() => courseStats(learner, now), [learner, day]); // eslint-disable-line react-hooks/exhaustive-deps -- per day, not per minute
  // How much real text the known words open up (#412): only ever goes up as words are learned.
  const readable = useMemo(() => readableCount(learner), [learner]);
  if (stats.known + stats.learning === 0) return null;
  const max = Math.max(1, ...stats.days.map((d) => d.reviews));
  const lang = language(code).name;
  return (
    <section className="progress" aria-label="Your progress">
      <div className="progress-line">
        {stats.known > 0 ? (
          <p>
            You know <strong>{stats.known}</strong> {stats.known === 1 ? "word" : "words"} of {lang}.
            {readable > 0 && <> You can read {plural(readable, "sentence")} from the course.</>}
          </p>
        ) : (
          <p>
            You are learning <strong>{stats.learning}</strong> {stats.learning === 1 ? "word" : "words"}.
          </p>
        )}
      </div>
      <p className="muted small">{KNOWN_RULE}</p>
      {stats.days.some((d) => d.reviews) && (
        <>
          <p className="small">
            {stats.retention30 !== null
              ? `Remembered when a word came back on a later day: ${Math.round(stats.retention30 * 100)}% in the last 30 days (target ${Math.round(learner.course.retention * 100)}%).`
              : "How often you remember a word on a later day shows here after 20 such answers."}
          </p>
          <div className="activity" role="img" aria-label="Reviews per day, last 30 days">
            {stats.days.map((d, i) => (
              <div key={d.day} className={i === 29 ? "today" : undefined} title={d.reviews ? `${new Date(d.day).toLocaleDateString("en", { month: "short", day: "numeric" })}: ${plural(d.reviews, "review")}` : restDayLine(new Date(d.day).toLocaleDateString("en", { month: "short", day: "numeric" }))} style={{ height: `${Math.max(4, (d.reviews / max) * 100)}%` }} />
            ))}
          </div>
          <div className="activity-cap">
            <span>Reviews, 30 days ago</span>
            <span>today</span>
          </div>
        </>
      )}
    </section>
  );
}
