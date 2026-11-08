// The reader's script (#928, docs/story-loop.md): the story as one simulated
// learner meets it, written out for a fresh reader. One part per note, in day
// order, each ending on its note, so a reader answers before reading on.
// Course-language words the learner does not know that day show as ▢▢▢.
//
// A word of a note that no deck teaches (the gardener's own, timeline.ts
// courseStory) is never known, so the app always shows it faint. In the script
// it is masked in the first note it is in and shown from the next one on: by
// then its note and the garden have shown what it is (the tiny door, the
// brambles, the stile, the far light, the mouse's name).

import { language } from "../content/languages";
import type { DeckLang } from "../deck/langs";
import { ANSWER_LINE } from "../garden/lookout";
import type { Ink } from "../garden/notes/read";
import { SCENERY } from "../garden/scenery";
import type { StoryEvent } from "../garden/story";
import { VISITORS } from "../garden/visitors";
import { hillOpens, type Met, type Projection } from "./timeline";
import { onDay, type Trace } from "./trace";

const MASK = "▢▢▢";
/** A run of days with nothing new this long or longer gets its own line; a shorter one shows only in the day numbers. */
const QUIET_DAYS = 7;

/** What the reader is told before part 1 (from docs/garden-play.md): the garden on day 1, and how to read the script. Nothing of the story. */
function frame(lang: DeckLang): string {
  const name = language(lang).name;
  return `# A garden, part by part

You are learning ${name} in an app, a few minutes a day. Each day, after your practice, you can walk in a small garden. Nobody else is there.

**The garden on day 1.** The words you learn grow as plants in beds. There is a bench by a pond, a sundial, a sunflower and a small open shed with nails on its back wall. A tall hedge runs along one side. In it is an old wooden door, locked; at dusk a warm light shows through its keyhole. A step to its left, at the foot of the hedge, is a tiny arched door about a hand high, with a mat in front of it. It is locked too. At the back of the garden is a low white fence, and right behind it brambles grow taller than you. Over them you see the green top of a small hill. Green hills lie all round. At dusk, lanterns come on. Some animals come to the garden when you learn their words.

**How to read this.**
- The story comes in parts. Read one part, answer the questions about it, and only then ask for the next part.
- Days count from your first day in the app. "You know 250 words" is how many ${name} words you know that day.
- Anything written in the garden is in ${name}, with no translation. A word you do not know yet shows as ${MASK}. You see that a word is there, but you can't read it.
- ~~A word~~ like this was crossed out by the hand that wrote it.
- Tap a thing in the garden and its name shows on a small tag: "el banco · bench". Some things also show a short line under their name. We assume you tap each thing on the day it has a new line.
- We assume you read each note on the day it comes.
- A week or more with nothing new is one line here. In the app, you would still come for a few minutes on each of those days.
- Do not look anything up or translate with a tool. Work out what you can from the words you know.
`;
}

/** What the reader meets: a story event, or a place that opens the walk after its note. */
type Item = { day: number } & ({ kind: "met"; met: Met } | { kind: "change"; text: string });

/** The reader's script: file name → text. One part per note, `NN-<note id>.md`; part 1 starts with the frame. */
export function readerScript(p: Projection, trace: Trace, lang: DeckLang, gardener: ReadonlySet<string>): Map<string, string> {
  const last = p.met.at(-1);
  if (last?.event.kind !== "note") throw new Error("the script ends on a note: the trace must reach the door");

  const items: Item[] = p.met.map((met) => ({ day: met.day, kind: "met", met }));
  for (const { day, event } of p.met) {
    if (event.kind !== "note") continue;
    const after = hillOpens(day);
    if (event.opens.includes("hill") && after !== null) items.push({ day: after, kind: "change", text: HILL_CHANGE });
    if (event.opens.includes("answer")) items.push({ day: day + 1, kind: "change", text: answerChange(lang) });
  }
  // A change comes first on its day: the way up is open before the stool's line. Notes stay last.
  const rank = (i: Item) => (i.kind === "change" ? 0 : i.met.event.kind === "note" ? 2 : 1);
  items.sort((a, b) => a.day - b.day || rank(a) - rank(b));

  const seen = new Set<string>();
  const show = (ink: Ink[] | undefined) =>
    need(ink)
      .map((i) => {
        if (i.style === "struck") return `~~${i.text}~~`;
        if (i.style === "clear") return i.text;
        return gardener.has(i.text.toLowerCase()) && seen.has(i.text.toLowerCase()) ? i.text : MASK;
      })
      .join("");
  const tapped = new Set<string>();
  let frogHeard = false;
  /** One day's lines, except its note: the frog's lines of a day go in one. */
  const lines = (day: readonly Item[]): string[] => {
    const out: string[] = [];
    const frog = day.flatMap((i) => (i.kind === "met" && i.met.event.kind === "frog" ? [`«${show(i.met.ink)}»`] : []));
    for (const i of day) {
      if (i.kind === "change") {
        out.push(i.text);
        continue;
      }
      const { event, ink } = i.met;
      if (event.kind === "thought") {
        const { thing } = event.thought;
        // The app shows only a thing's newest line (thoughtFor); no trace meets two at once yet.
        if (day.some((j) => j !== i && j.kind === "met" && j.met.event.kind === "thought" && j.met.event.thought.thing === thing)) throw new Error(`two new lines on the ${thing} on day ${i.day}`);
        const { words, gloss } = SCENERY[thing];
        out.push(`You tap the ${gloss} (${words[lang]} · ${gloss}). ${tapped.has(thing) ? "A new line" : "Under its name"}: «${show(ink)}»`);
        tapped.add(thing);
      } else if (event.kind === "visitor") {
        const v = VISITORS.find((d) => d.id === event.visitor);
        if (!v) throw new Error(`no visitor ${event.visitor}`);
        const comes = `From today, a ${v.gloss} comes to the garden (${v.words[lang]} · ${v.gloss}).`;
        out.push("garden" in event.gate ? `In your practice you get the word «${v.words[lang]}» (${v.gloss}) right. ${comes}` : comes);
      } else if (event.kind === "key") {
        out.push("A small brass key now lies on the ground in the garden. You find it. It opens the old wooden door in the hedge, onto an orchard, and the door stays open.");
      }
    }
    if (frog.length) {
      out.push(
        frogHeard
          ? `The frog has ${frog.length === 1 ? "a new line" : "new lines"}, which it says before its last one: ${frog.join(" ")}`
          : `At dusk the frog on the lily pad is awake. Tap it and it croaks a word you know. Tap it again, another word. Tap again, and it says one line for each tap, then only croaks: ${frog.join(" ")}`,
      );
      frogHeard = true;
    }
    return out.map((l) => `- ${l}`);
  };

  const files = new Map<string, string>();
  let part: string[] = [frame(lang)];
  let lastDay = 0;
  let from = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const next = items[i + 1];
    const isNote = item.kind === "met" && item.met.event.kind === "note";
    // A day's lines go out under one heading at its last thing, or with its note (notes come last).
    if (!isNote && next?.day === item.day) continue;
    const day = items.slice(from, isNote ? i : i + 1);
    from = i + 1;
    if (item.day - lastDay > QUIET_DAYS) part.push(quiet(lastDay + 1, item.day - 1));
    // Only a second note on one day starts a part on the day the last one ended.
    const head = `**Day ${item.day}${item.day === lastDay ? ", later" : ""}** · you know ${onDay(trace, item.day).known} words`;
    lastDay = item.day;
    part.push([head, ...lines(day)].join("\n"));
    if (item.kind !== "met" || item.met.event.kind !== "note") continue;
    part.push(noteLine(item.met.event, show(item.met.ink)));
    for (const ink of need(item.met.ink)) if (ink.style === "faint" && gardener.has(ink.text.toLowerCase())) seen.add(ink.text.toLowerCase());
    const n = files.size + 1;
    part.push(`*End of part ${n}.*`);
    files.set(`${String(n).padStart(2, "0")}-${item.met.event.note.id}.md`, `${part.join("\n\n")}\n`);
    part = [`# Part ${n + 1}`];
  }
  return files;
}

/** Text events always carry their ink (timeline.ts). */
function need(ink: Ink[] | undefined): Ink[] {
  if (!ink) throw new Error("a written event without its ink");
  return ink;
}

function quiet(from: number, to: number): string {
  return `*Days ${from}–${to}: nothing new in the garden.*`;
}

/** Where a note is found, and its text as the reader sees it. */
function noteLine({ note, opens }: Extract<StoryEvent, { kind: "note" }>, text: string): string {
  const where = opens.includes("stile")
    ? "Something is new at the back fence. In the fence, behind the first bed, is an old wooden stile, but the brambles have grown over its steps, and you can't get to it. On the path in front of the brambles, a note lies under a flat stone."
    : note.beat === "stile"
      ? "A new note lies under the flat stone in front of the stile."
      : opens.includes("diary")
        ? "On the hill, beside the stool, a small book now lies on a flat stone, with a red ribbon out of it. It is a diary, in the same hand as the notes. Its first page:"
        : note.diary
          ? "On the hill, a red ribbon lies out of the diary on the stone. A new page:"
          : opens.includes("door")
            ? "The tiny door at the foot of the hedge stands open. Behind it is a low, dark doorway, and a folded paper lies half out of it, on the mat."
            : "A new note hangs on a nail in the shed.";
  return `${where}\n\n${text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n>\n")}`;
}

/** The walk after the hill's note (docs/garden-play.md, "After note n08"). */
const HILL_CHANGE =
  "The brambles round the stile are cut back. The stile stands clear, and a way is cut through the brambles to an old path up the hill. On the grassy hilltop: an old wooden stool facing a valley, and a lantern on a post in front of it. Across the valley, on the far hills, stands a small house with a lantern beside it. At night both lanterns are lit: yours near you, and the far one, a small yellow light across the valley.";

/** The walk after the answer's note (docs/garden-play.md, "Two signals"). */
function answerChange(lang: DeckLang): string {
  return `On the hill at night, you blow out your lantern and light it again, twice. A few seconds later, across the valley, the far light goes out and comes back on, slowly, twice. A short line rises low on the screen: «${ANSWER_LINE[lang]}»`;
}
