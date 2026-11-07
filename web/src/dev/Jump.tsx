// ?demo with no value (#751): the story's points, to stand in the garden at
// any of them in seconds. Each is a link (so it can be bookmarked too) that
// makes a fresh demo learner who knows just enough words (boot.ts).

import { useState } from "react";
import { language } from "../content/languages";
import { useUser } from "../data/auth";
import { DECK_LANGS, type DeckLang } from "../deck/langs";
import { Segmented } from "../ui/arrows";
import { AlertIcon, ChevronDownIcon } from "../ui/icons";
import { storyJumps } from "./jumps";

export default function Jump() {
  const [lang, setLang] = useState<DeckLang>("es");
  const [going, setGoing] = useState<number | null>(null);
  const { user } = useUser();
  return (
    <main className="app page jump-page">
      <h1>Jump to a story point</h1>
      <p className="muted">Each point makes a new demo learner who knows just enough words, and opens the garden there. Your own progress does not change.</p>
      {user && !user.anonymous && (
        <p className="jump-warn" role="note">
          <AlertIcon size={18} />
          <span>You are signed in. A jump signs you out in this browser. To stay signed in, open this page in a private tab.</span>
        </p>
      )}
      <Segmented label="Course" options={DECK_LANGS.map((code) => [code, language(code).name])} value={lang} onChange={setLang} className="jump-langs" />
      <ol className="jump-list">
        {storyJumps(lang).map((j) => (
          <li key={`${j.known}-${j.title}`}>
            <a className="jump" href={`/?demo=${lang}:known:${j.known}#/garden`} onClick={() => setGoing(j.known)} aria-busy={going === j.known}>
              <span className="jump-text">
                <span className="jump-part">{j.part}</span>
                <span className="jump-title">{j.title}</span>
                <span className="jump-line" lang={lang}>
                  {j.line}
                </span>
              </span>
              <span className="jump-known">{going === j.known ? "Opening…" : `${j.known} words`}</span>
              <ChevronDownIcon size={18} className="jump-go" />
            </a>
          </li>
        ))}
      </ol>
    </main>
  );
}
