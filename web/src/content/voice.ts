// The garden's small voice (docs/voice.md): rotating lines that keep the
// screens alive without repeating. The clear sentence always comes first in
// the UI; these are the wink after it. Simple words, no idioms, no "!".

import { hash32 } from "../lib/seed";
import { daily, rareDay } from "../core/day";

/** One line per plant, chosen by the word, so a plant always says the same thing. */
export const PLANT_LINES = {
  sprout: [
    "Small, but trying.",
    "It has two leaves. It is proud of both.",
    "Still deciding which way is up.",
    "New here. Very curious.",
    "It grew a little while you read this.",
    "Tiny. Not worried about it.",
  ],
  bud: [
    "Almost ready.",
    "It practises opening when no one looks.",
    "Something is about to happen.",
    "Not open yet. Soon.",
    "It is thinking about a colour.",
    "Nearly there. It knows.",
  ],
  bloom: [
    "Showing off a little. It earned it.",
    "The bees know this one.",
    "It remembers you too.",
    "Open and happy about it.",
    "A good word. Very sure of itself.",
    "It likes the sun. And you.",
  ],
  old: ["Old friend. Very calm.", "It has seen many seasons.", "Deep roots. Not going anywhere.", "It knows all the other plants."],
  thirsty: ["It is looking at the watering can.", "It would like some practice.", "A little tired. Not sad."],
} as const;

export function plantLine(word: string, kind: keyof typeof PLANT_LINES): string {
  const pool = PLANT_LINES[kind];
  return pool[hash32(word) % pool.length];
}

/** The 3D garden's loading line: the verb changes, the percent stays. */
export function loadingLine(now = new Date()): string {
  const night = now.getHours() >= 21 || now.getHours() < 5;
  return daily(
    night
      ? ["Turning on the moon", "Quietly. The plants are asleep", "Finding the lanterns"]
      : ["Growing your plants", "Waking up the flowers", "Counting the leaves", "Opening the gate", "Telling the snail you are here", "Watering the paths"],
    "loading",
    now,
  );
}

/**
 * The end-of-session headline, from the garden's point of view. `answers`: the
 * learner's answers so far, so each session of the day gets its own pick (#270).
 */
export function summaryHeadline(lang: string, answers: number, now = new Date()): { line: string; small?: string } {
  // daily and rareDay pick once per key and day: the answer count in the key makes it once per session.
  const key = (name: string) => `${name}:${answers}`;
  if (rareDay(5, key("praise-" + lang), now)) return lang === "de" ? { line: "Gut gemacht.", small: "Well done." } : { line: "¡Muy bien!", small: "Very good." };
  const night = now.getHours() >= 22 || now.getHours() < 5;
  if (night) return { line: daily(["The moon saw that.", "Well done. The owls agree.", "Good work. Very quiet work."], key("summary-night"), now) };
  if (now.getMonth() === 9 && rareDay(3, key("pumpkin"), now)) return { line: "Good work. The pumpkins are jealous." };
  return {
    line: daily(
      [
        "Well done.",
        "The garden is a little taller now.",
        "A bee noticed.",
        "Watered. Every leaf is happy.",
        "The plants will grow tonight.",
        "Good work. Now drink some water too.",
        "The bees will hear about this.",
        "Done. The roots are busy.",
        "Nice. The soil feels good about it.",
        "Well done. A worm nodded.",
      ],
      key("summary"),
      now,
    ),
  };
}

/** A second clause for the Today greeting, on about one day in five. */
export function greetingAside(now = new Date()): string | null {
  const h = now.getHours();
  if (h >= 23 || h < 4) return daily(["Hello, night gardener.", "The plants are asleep. You are not.", "Quiet hour. Good for words."], "night", now);
  if (!rareDay(5, "aside", now)) return null;
  if (h < 12) return daily(["The dew is still on the leaves.", "The flowers are opening.", "A bird is already up."], "aside-morning", now);
  if (h < 18) return daily(["A bee is working hard.", "The sun is on the beds.", "The snail is on its way."], "aside-afternoon", now);
  return daily(["The flowers are closing.", "The lanterns are coming on.", "The garden is getting quiet."], "aside-evening", now);
}

/** Under "The garden is watered for today.": a quiet wink, never a count or a quota. */
export function doneTodayNote(now = new Date()): string {
  return daily(["The plants are busy growing now.", "Extra practice is fine. The plants will not tell anyone.", "The roots grow while you rest.", "The worms are busy under the soil."], "done-today", now);
}

/** After "I forgot": what happens next, then (sometimes) a kind word. */
export function forgotLine(retry: boolean, now = new Date()): string {
  const next = retry ? "You will see this word again soon." : "You will see this word again next time.";
  const wink = daily([null, null, "Forgetting is part of it.", "It happens to every plant.", "Roots grow under the ground first.", null], "forgot", now);
  return wink ? `${next} ${wink}` : next;
}

/** Small asides in quiet system copy (#68): the clear part never changes. */
export const sendingLabel = (now = new Date()) => (rareDay(6, "by-bee", now) ? "Sending… by bee" : "Sending…");
export const savedLine = (now = new Date()) => (rareDay(4, "saved", now) ? "All changes are saved. The gardener wrote them down." : "All changes are saved.");
export const errorLine = (now = new Date()) => (rareDay(3, "leaf", now) ? "Something went wrong. Try again. A leaf fell in the machine." : "Something went wrong. Try again.");
export const SOUND_OFF_ASIDE = "The birds will sing quietly to themselves.";
/** The Today activity chart's tooltip for a day with no reviews. */
export const restDayLine = (date: string) => `${date}: rest day. Plants grow on rest days too.`;

// ---- The empty garden (#58): bare soil, never "nothing here" ----

/** The walk's card when there are no plants yet. */
export const EMPTY_WALK = { title: "Just soil for now. Very good soil.", body: "Each word you learn grows into a plant here.", cta: "Plant my first words" } as const;
/** The worm asleep in an empty strip, under its word. */
export const WORM_LINE = "Waiting.";
/** "Reserved", per course language, small under the stake's English. */
const RESERVED: Record<string, string> = { es: "Reservado", de: "Reserviert" };

/** The stake in an empty strip: the clear line in English, and the course language's word small below. */
export function reservedStake(langName: string, code: string): { line: string; local?: string } {
  return { line: `Reserved for ${langName} words`, local: RESERVED[code] };
}

export type WordsFilter = "all" | "known" | "learning" | "new" | "suspended" | "mine";

/** A search that finds nothing: under All the course has no such word; elsewhere it may be in another list (#262). */
const SEARCH_MISS: Record<WordsFilter, string> = {
  all: "No word like this in the course.",
  known: "No known word like this. Try All.",
  learning: "No word like this in progress. Try All.",
  new: "No new word like this. Try All.",
  suspended: "No paused word like this. Try All.",
  mine: "No word like this from your texts. Try All.",
};

/** The Words list with no rows: what is missing first, a small wink for some. */
export function wordsEmptyLine(filter: WordsFilter, searching: boolean): string {
  // "All" is the whole course, so it is empty only under a search.
  if (searching || filter === "all") return SEARCH_MISS[filter];
  return {
    known: "No flowers yet. They are coming.",
    learning: "No words in progress right now.",
    new: "No new words left in the course.",
    suspended: "No paused words. Everyone is awake.",
    mine: "No words from your texts yet.",
  }[filter];
}

/** Under the garden on the first session's summary. */
export const firstPlantsLine = (n: number) => (n === 1 ? "Your first plant." : `Your first ${n} plants.`);

/** The summary's first line, in the past tense, leaving out a part that is zero: "You planted 3 seeds and watered 21 plants." */
export function didLine(seeds: number, watered: number): string {
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  const parts = [seeds > 0 && `planted ${count(seeds, "seed")}`, watered > 0 && `watered ${count(watered, "plant")}`].filter(Boolean);
  return `You ${parts.join(" and ")}.`;
}

/** Shown once on the landing page after an account is deleted. */
export function farewell(lang: string | null): { line: string; wish?: string } {
  return { line: "Your garden is gone. Thank you for growing it.", wish: lang === "de" ? "Viel Glück." : lang === "es" ? "¡Buena suerte!" : undefined };
}
