// A friend's gifted seed (#213), on arrival. With a course in its language,
// the word becomes the next new word (queued), and Today says so once. With
// courses in other languages only, a quiet card offers to start that one. On
// the landing page, GiftCard says what the seed is.

import { useEffect, useRef, useState } from "react";
import { clearGift, pendingGift, type Gift } from "../data/gift";
import { plantGift, useDeck, useLearner, useStore } from "../data/learner";
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
 * In the app, above Today, while a seed is kept on this device (App only renders
 * it then: the learner queries below are not free, #230). `courses` are the
 * learner's languages; `onStart` starts a course, as the language menu does.
 */
export function GiftArrival({ courses, onStart }: { courses: string[]; onStart: (lang: string) => void }) {
  const [gift, setGift] = useState(pendingGift);
  const word = useGiftWord(gift);
  // A word the deck no longer has (an old link): nothing to plant, nothing to show.
  useEffect(() => {
    if (word === "gone") clearGift();
  }, [word]);
  if (!gift || !word || word === "gone") return null;
  // "OK" on the note unmounts Planted, and with it its learner queries.
  if (courses.includes(gift.lang)) return <Planted gift={gift} word={word} onDone={() => setGift(null)} />;
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

/**
 * The seed's course exists: plant it once the learner has loaded, and say what
 * happened. A word the learner set aside ("never show", "pause") stays that way.
 */
function Planted({ gift, word, onDone }: { gift: Gift; word: { lemma: string; gloss: string }; onDone: () => void }) {
  const learner = useLearner(gift.lang);
  const store = useStore();
  const tried = useRef(false);
  useEffect(() => {
    if (!learner || tried.current) return; // Waiting for its words to load.
    tried.current = true;
    if (readMemory(learner, gift.wordId)?.reps) return clearGift(); // Already growing: nothing to plant.
    void plantGift(store, gift.wordId).then(
      (planted) => {
        if (planted) track("seed_planted", { lang: gift.lang });
        clearGift();
      },
      // Kept on this device, so the next visit tries again.
      (e: unknown) => console.error("[seed] not planted", e),
    );
  }, [learner, gift, store]);
  if (!learner) return null;
  // Live: the first data after a page load can be older than the server's (#229).
  const status = learner.words.get(gift.wordId)?.status;
  const line = readMemory(learner, gift.wordId)?.reps
    ? `You already grow ${word.lemma}. Your friend has good taste.`
    : status === "ignored" || status === "paused"
      ? `A friend gave you a seed: ${word.lemma}. You set this word aside, so it stays that way.`
      : `Your friend's seed is planted: ${word.lemma} (${word.gloss}). You will meet it soon.`;
  return (
    <p className="gift-card" role="status">
      {line}{" "}
      <button className="ghost" onClick={onDone}>
        OK
      </button>
    </p>
  );
}
