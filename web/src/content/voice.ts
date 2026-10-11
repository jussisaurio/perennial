// The garden's small voice (docs/voice.md): rotating lines that keep the
// screens alive without repeating. The clear sentence always comes first in
// the UI; these are the wink after it. Simple words, no idioms, no "!".

import { daily, rareDay } from "../ui/whimsy";

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

function hashWord(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}

export function plantLine(word: string, kind: keyof typeof PLANT_LINES): string {
  const pool = PLANT_LINES[kind];
  return pool[hashWord(word) % pool.length];
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

/** The end-of-session headline, from the garden's point of view. */
export function summaryHeadline(lang: string, now = new Date()): { line: string; small?: string } {
  if (rareDay(5, "praise-" + lang, now)) return lang === "de" ? { line: "Gut gemacht.", small: "Well done." } : { line: "¡Muy bien!", small: "Very good." };
  const night = now.getHours() >= 22 || now.getHours() < 5;
  if (night) return { line: daily(["The moon saw that.", "Well done. The owls agree.", "Good work. Very quiet work."], "summary-night", now) };
  if (now.getMonth() === 9 && rareDay(3, "pumpkin", now)) return { line: "Good work. The pumpkins are jealous." };
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
      "summary",
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

/** The default start note: the promise first, a garden wink sometimes. */
export function startNote(now = new Date()): string {
  return daily(
    [
      "Missed days do not pile up. We choose the most useful practice for your time.",
      "Missed days do not pile up. Plants are patient.",
      "A few minutes. The garden does the rest.",
      "Missed days do not pile up. We pick the words that need you most.",
    ],
    "start-note",
    now,
  );
}

export function doneTodayNote(now = new Date()): string {
  return daily(["You did your minutes for today. More practice is a bonus.", "Today is done. The plants are busy growing.", "Extra practice is fine. The plants will not tell anyone."], "done-today", now);
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

/** Shown once on the landing page after an account is deleted. */
export function farewell(lang: string | null): { line: string; wish?: string } {
  return { line: "Your garden is gone. Thank you for growing it.", wish: lang === "de" ? "Viel Glück." : lang === "es" ? "¡Buena suerte!" : undefined };
}
