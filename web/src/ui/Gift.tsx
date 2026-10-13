// A friend's gifted seed (#213), on arrival. With a course in its language,
// the word becomes the next new word (queued), and Today says so once. With
// courses in other languages only, a quiet card offers to start that one. On
// the landing page, GiftCard says what the seed is.

import { useEffect, useRef, useState } from "react";
import { clearGift, pendingGift, type Gift } from "../data/gift";
import { setWordStatus, useDeck, useLearner, useStore } from "../data/learner";
import { readMemory } from "../core/memory";
import { language } from "../content/languages";
import { track } from "../observability";

/** The gifted word from its deck, or null while the deck loads; "gone" when the deck has no such word. */
function useGiftWord(gift: Gift | null): { lemma: string; gloss: string } | null | "gone" {
  const { deck } = useDeck(gift?.lang);
  if (!gift || !deck) return null;
  // loadDeck leaves out retired words, so an old link's word is simply not found.
  const w = deck.words.find((x) => x.id === gift.wordId);
  return w ? { lemma: w.lemma, gloss: w.gloss } : "gone";
}

/** On the landing page: what the seed is, and that starting this language plants it first. */
export function GiftCard({ lang }: { lang: string }) {
  const [gift] = useState(pendingGift);
  const word = useGiftWord(gift);
  if (!gift || !word || word === "gone") return null;
  return (
    <p className="gift-card" role="note">
      A friend gave you a seed: <strong lang={gift.lang}>{word.lemma}</strong> ({word.gloss}).{" "}
      {gift.lang === lang ? "It will be your first plant." : `Start ${language(gift.lang).name}, and it will be your first plant there.`}
    </p>
  );
}

/**
 * In the app, above Today, on a visit that brought a seed (App only renders it
 * then: the learner queries below are not free). `courses` are the learner's
 * languages; `onStart` starts a course, as the language menu does.
 */
export function GiftArrival({ courses, onStart }: { courses: string[]; onStart: (lang: string) => void }) {
  const [gift, setGift] = useState(pendingGift);
  const word = useGiftWord(gift);
  // A word the deck no longer has (an old link): nothing to plant, nothing to show.
  useEffect(() => {
    if (word === "gone") clearGift();
  }, [word]);
  if (!gift || !word || word === "gone") return null;
  if (courses.includes(gift.lang)) return <Planted gift={gift} word={word} />;
  return (
    <div className="gift-card" role="note">
      <p>
        A friend gave you a {language(gift.lang).name} seed: <strong lang={gift.lang}>{word.lemma}</strong> ({word.gloss}).
      </p>
      <div className="row">
        <button className="primary" onClick={() => onStart(gift.lang)}>
          Start {language(gift.lang).name}
        </button>
        <button
          className="ghost"
          onClick={() => {
            clearGift();
            setGift(null);
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}

/** The seed's course exists: queue the word once its learner has loaded, and say so. */
function Planted({ gift, word }: { gift: Gift; word: { lemma: string; gloss: string } }) {
  const learner = useLearner(gift.lang);
  const store = useStore();
  const [hidden, setHidden] = useState(false);
  const planted = useRef(false);
  useEffect(() => {
    if (!learner || planted.current) return; // Waiting for its words to load.
    planted.current = true;
    // Queue it unless it has started. Queuing a word that has in fact started (when
    // this first look is older than the server, #229) does nothing: started words are never new.
    if (!readMemory(learner, gift.wordId)?.reps && learner.words.get(gift.wordId)?.status !== "queued") void setWordStatus(store, gift.wordId, "queued");
    track("seed_planted", { lang: gift.lang });
    clearGift();
  }, [learner, gift, store]);
  if (!learner || hidden) return null;
  // Live: the first data after a page load can be older than the server's (#229),
  // so "already growing" is read again as the learner's reviews arrive.
  const growing = !!readMemory(learner, gift.wordId)?.reps;
  return (
    <p className="gift-card" role="status">
      {growing ? `You already grow ${word.lemma}. Your friend has good taste.` : `Your friend's seed comes next: ${word.lemma} (${word.gloss}).`}{" "}
      <button className="ghost" onClick={() => setHidden(true)}>
        OK
      </button>
    </p>
  );
}
