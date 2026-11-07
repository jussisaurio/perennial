import { language } from "../content/languages";
import { KNOWN_RULE } from "../core/memory";
import type { DeckSentences } from "../data/deck";
import { perLearnerDay, useDeckSentences, type Learner } from "../data/learner";
import { readableCount } from "../data/reading";
import { plural } from "./format";
import { statsToday } from "./stats";
import { useNow } from "./useNow";

// How much real text the known words open up (#412): only ever goes up as words are learned.
// Kept per learner, so a new visit to Words with no new answers does no work.
// One cache per deck's sentences, which are the same object for as long as the page is open.
const readableBy = new WeakMap<DeckSentences, (l: Learner, now: number) => number>();
function readableToday(l: Learner, sentences: DeckSentences, now: number): number {
  let today = readableBy.get(sentences);
  if (!today) readableBy.set(sentences, (today = perLearnerDay((x) => readableCount(x, sentences))));
  return today(l, now);
}

/** How the course is going, on the Words page: open, not behind "More progress". Today keeps only the day's action. */
export function Progress({ learner, lang: code }: { learner: Learner; lang: string }) {
  const now = useNow();
  const stats = statsToday.get(learner, now);
  // The count needs the deck's sentences, which come after its words (#608): the line waits for them.
  const { sentences } = useDeckSentences(code);
  const readable = sentences ? readableToday(learner, sentences, now) : 0;
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
              // Each day is a faint cell; a bar grows in it only on a day with reviews, so rest days don't read as a broken line.
              <div key={d.day} className={i === 29 ? "today" : undefined} title={d.reviews ? `${new Date(d.day).toLocaleDateString("en", { month: "short", day: "numeric" })}: ${plural(d.reviews, "review")}` : `${new Date(d.day).toLocaleDateString("en", { month: "short", day: "numeric" })}: rest day.`}>
                {d.reviews > 0 && <span style={{ height: `${Math.max(10, (d.reviews / max) * 100)}%` }} />}
              </div>
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
