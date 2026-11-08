import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Schema } from "effect";
import deckEs from "../../../decks/es/deck.json";
import deckDe from "../../../decks/de/deck.json";
import { courseOrder } from "../content/order";
import { Deck, GARDEN_WORDS } from "../deck/schema";
import { medianDayKnowing, type Runs, type Trace } from "../sim/trace";
import { storyEvents, type StoryEvent } from "./story";
import { NO_FACTS, VISITORS } from "./visitors";

const SRC = join(import.meta.dir, "..");
const NOW = new Date("2026-11-08T12:00:00Z");

/** The course's live words in course order, as the app has them (data/deck.ts, content/order.ts). */
const course = (lang: "es" | "de", deck: unknown) =>
  courseOrder({ words: Schema.decodeUnknownSync(Deck(lang))(deck).words.filter((w) => !w.retired && !w.aliasOf) });
const COURSES = { es: course("es", deckEs), de: course("de", deckDe) };
const TRACES: Record<"es" | "de", Trace> = {
  es: await Bun.file(new URL("../sim/traces/es-daily.json", import.meta.url)).json(),
  de: await Bun.file(new URL("../sim/traces/de-daily.json", import.meta.url)).json(),
};
const RUNS: Record<"es" | "de", Runs> = {
  es: await Bun.file(new URL("../sim/traces/es-daily-seeds.json", import.meta.url)).json(),
  de: await Bun.file(new URL("../sim/traces/de-daily-seeds.json", import.meta.url)).json(),
};

const gates = (events: readonly StoryEvent[]) => events.map((e) => e.gate);

for (const lang of ["es", "de"] as const) {
  describe(`${lang} story events`, () => {
    const words = COURSES[lang];
    const events = storyEvents(lang, words);

    test("come in the order a learner meets them", () => {
      expect(events.map((e) => e.at)).toEqual(events.map((e) => e.at).toSorted((a, b) => a - b));
    });

    test("a garden word's event comes by its place in the course", () => {
      // The cat is the course's 3rd word (content/order.ts gardenSlot), so a learner who knows 3 words has it.
      expect(events.find((e) => e.kind === "visitor" && e.visitor === "cat")?.at).toBe(3);
      const key = events.find((e) => e.kind === "key")!;
      expect(words[key.at - 1].garden).toBe("key");
    });

    test("each place comes with its note, and the last note opens the mouse door", () => {
      expect(events.filter((e) => e.kind === "note" && e.opens.length).map((e) => e.kind === "note" && e.opens)).toEqual([["stile"], ["hill"], ["diary"], ["answer"], ["door"]]);
      expect(events.findLast((e) => e.kind === "note")).toMatchObject({ opens: ["door"] });
    });

    // The story's pace (#883), for the learner who does Today's 5 minutes every day (sim/learner.ts): the median
    // of many seeds, since one seed's days are luck that any deck change reshuffles (#952).
    describe("for the median daily learner", () => {
      const runs = RUNS[lang];
      const notes = events.flatMap((e) => (e.kind === "note" ? [e.at] : []));
      // !: every run goes on until it knows the door's count, the last note's.
      const day = (known: number) => medianDayKnowing(runs, known)!;

      test("the traces end at this door (else run `bun run sim:learners` again)", () => {
        expect([TRACES[lang].door, runs.door]).toEqual([notes.at(-1)!, notes.at(-1)!]);
      });

      test("the mouse door opens after about a year", () => {
        expect(day(notes.at(-1)!)).toBeWithin(335, 396);
      });

      test("a note comes at least every five weeks", () => {
        const gaps = notes.slice(1).map((n, i) => day(n) - day(notes[i]));
        expect(Math.max(...gaps)).toBeLessThanOrEqual(35);
      });
    });
  });
}

describe("every gate is in the story's list", () => {
  const visitorGates = (id: string) => gates(storyEvents("es", COURSES.es).filter((e) => e.kind === "visitor" && e.visitor === id));

  // A visitor's schedule is code, so a gate in it (like the frog's 150 known words, once missing here) can hide
  // from the list. Ask each one when it comes, and hold that to its gates in the list.
  test("a visitor comes exactly when its gates in the list say", () => {
    // Rare visitors come by the calendar, not by learning.
    for (const v of VISITORS.filter((x) => !x.rare)) {
      const own = visitorGates(v.id);
      const opens = (known: number, garden: ReadonlySet<string>) => !own.length || own.some((g) => ("known" in g ? known >= g.known : garden.has(g.garden)));
      for (let known = 0; known <= 2500; known++) {
        expect([v.id, known, v.schedule({ facts: { ...NO_FACTS, known }, now: NOW })]).toEqual([v.id, known, opens(known, new Set())]);
      }
      for (const g of GARDEN_WORDS) {
        expect([v.id, g, v.schedule({ facts: { ...NO_FACTS, garden: new Set([g]) }, now: NOW })]).toEqual([v.id, g, opens(0, new Set([g]))]);
      }
    }
  });

  /** The app's source files, without the tests and the learner simulation (sim/, a tool that opens nothing): path from web/src, and text. */
  const sources = [...new Bun.Glob("**/*.{ts,tsx}").scanSync(SRC)]
    .filter((p) => !/\.test\.tsx?$/.test(p) && !p.startsWith("sim/"))
    .map((path) => ({ path, text: readFileSync(join(SRC, path), "utf8") }));

  // A gate is new code, not a new row in a table the list reads, so only a look at the code finds one the list
  // misses. Garden words are the gates still to come (#209), so those are checked by name.
  test("every garden word the code asks for by name is a gate", () => {
    const listed = new Set(gates(storyEvents("es", COURSES.es)).flatMap((g) => ("garden" in g ? [g.garden] : [])));
    for (const { path, text } of sources) {
      for (const m of text.matchAll(/garden\.has\("(\w+)"\)|gardenBroughtAt\([^,()]+,\s*"(\w+)"\)/g)) {
        // `??`: one of the two groups matched.
        const word = m[1] ?? m[2];
        expect([path, word, listed.has(word)]).toEqual([path, word, true]);
      }
    }
  });

  // The places that read what the learner has learned, to open something. Each is in the list: a new one fails
  // here until it is added to story.ts, then here.
  const READS_GATES: Record<string, string> = {
    "garden/visitors.ts": "the visitors' schedules (checked against their gates above)",
    "ui/visitors.ts": "makes the learner's facts, and reads them for the frog's lines and the thoughts",
    "ui/Home.tsx": "the notes, for the pin on the shed",
    "ui/GardenWalk.tsx": "the notes, and the key",
    "ui/Session.tsx": "the garden-word visitors, for the one that watches a chunk",
  };
  test("only the known places read what the learner has learned", () => {
    const reads = sources.filter((s) => /\bfacts\.(known|garden)\b|\bgardenBrought(At)?\(/.test(s.text)).map((s) => s.path);
    expect(reads.toSorted()).toEqual(Object.keys(READS_GATES).toSorted());
  });
});
