// The look tool's command line (#974): its flags and its small step language, read in one
// place for the command (look.ts) and the run (look.run.ts). No Playwright here.

export const USAGE = `Drive the app and get a picture and a state file after each step. From web/:

  bun run look <folder> --demo <level> [--spot <name>] [--time day|dusk|night]
                        [--view desktop|phone] [--theme light|dark] [step ...]

  <folder>   where the files go (absolute path): 00-start.png, 00-start.json, 01-<step>.png, ...
  --demo     the demo learner: es:30, es:800, es:known:566, de:800 (words studied, or words known)
  --spot     open the garden walk and stand at a named spot (e2e/spots.ts); "walk" is where the walk opens.
             Without it, the run starts on Today.
  defaults   --time day --view desktop --theme light

Steps, each one quoted argument, run in order:

  "hold w 3"            hold a key for 3 seconds of the garden's own time. Keys: w a s d walk,
                        ArrowLeft and ArrowRight turn, Shift runs. Join keys with +: "hold Shift+w 2"
  "press Escape"        press a key once (Playwright key names: Enter, Escape, Space, 1, ...)
  "tap stile"           tap the middle of a thing in view, by its name in the last state file
                        (garden.things, or a label's text); the nearest one of that name
  "tap 200,340"         tap a point on the page (CSS pixels)
  "click Sit on the bench"   click a button, tab or link by its exact accessible name
  "wait 2"              wait 2 seconds of the garden's own time
  "wait mode free"      wait for the walker's mode: free, trip (walking to a tapped spot), glide, seated
  "wait reach read"     wait until the action button does this (scene.ts Reach), or "wait reach none"
  "wait text Settings"  wait until this text shows

A tap lands on what is nearest at that point, as it does for a learner: if a plant covers the thing,
walk until the picture shows it clear, then tap.

Example: walk from the gate to the stile and read the state there.

  bun run look /abs/folder --demo es:800 --spot walk "hold a 0.8" "hold w 5" "tap stile" "wait mode free"
`;

export type Step =
  | { kind: "hold"; keys: string[]; seconds: number }
  | { kind: "press"; key: string }
  | { kind: "tap"; at: { name: string } | { x: number; y: number } }
  | { kind: "click"; name: string }
  | { kind: "wait"; until: { seconds: number } | { mode: string } | { reach: string | null } | { text: string } };

const VIEWS = ["desktop", "phone"] as const;
const THEMES = ["light", "dark"] as const;
const TIMES_OF_DAY = ["day", "dusk", "night"] as const;
const MODES = ["free", "trip", "glide", "seated"];

export interface Run {
  dir: string;
  demo: string;
  /** null: start on Today, not in the garden. */
  spot: string | null;
  time: (typeof TIMES_OF_DAY)[number];
  view: (typeof VIEWS)[number];
  theme: (typeof THEMES)[number];
  steps: { text: string; step: Step }[];
}

const seconds = (text: string, s: string): number => {
  const n = Number(s);
  if (!(n > 0)) throw new Error(`"${text}": "${s}" is not a number of seconds above 0`);
  return n;
};

function parseStep(text: string): Step {
  const [verb, ...words] = text.trim().split(/\s+/);
  const rest = words.join(" ");
  if (rest === "") throw new Error(`"${text}": the step needs something after "${verb}"`);
  switch (verb) {
    case "hold": {
      if (words.length !== 2) throw new Error(`"${text}": write it as "hold <keys> <seconds>", like "hold w 3"`);
      return { kind: "hold", keys: words[0].split("+"), seconds: seconds(text, words[1]) };
    }
    case "press":
      return { kind: "press", key: rest };
    case "tap": {
      const point = /^(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(rest);
      return { kind: "tap", at: point ? { x: Number(point[1]), y: Number(point[2]) } : { name: rest } };
    }
    case "click":
      return { kind: "click", name: rest };
    case "wait": {
      if (words[0] === "mode") {
        if (!MODES.includes(words[1])) throw new Error(`"${text}": the modes are ${MODES.join(", ")}`);
        return { kind: "wait", until: { mode: words[1] } };
      }
      if (words[0] === "reach" && words.length === 2) return { kind: "wait", until: { reach: words[1] === "none" ? null : words[1] } };
      if (words[0] === "text" && words.length > 1) return { kind: "wait", until: { text: words.slice(1).join(" ") } };
      if (words.length === 1) return { kind: "wait", until: { seconds: seconds(text, words[0]) } };
      throw new Error(`"${text}": write it as "wait <seconds>", "wait mode <mode>", "wait reach <act|none>" or "wait text <text>"`);
    }
    default:
      throw new Error(`"${text}": no step starts with "${verb}". The steps are hold, press, tap, click and wait`);
  }
}

/** Read the command's arguments. `spots`: the names --spot may have. Throws with a line that says what to fix. */
export function parseRun(argv: readonly string[], spots: readonly string[]): Run {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) rest.push(a);
    else if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
    else flags[a.slice(2)] = argv[++i];
  }
  const unknown = Object.keys(flags).filter((f) => !["demo", "spot", "time", "view", "theme"].includes(f));
  if (unknown.length > 0) throw new Error(`no such flag: --${unknown[0]}`);
  const [dir, ...steps] = rest;
  if (dir === undefined || !dir.startsWith("/")) throw new Error("the first argument is the folder for the files, as an absolute path");
  if (flags.demo === undefined || !/^[a-z]{2}:(known:)?\d+$/.test(flags.demo)) throw new Error("--demo is the demo learner's level, like es:800 or es:known:566");
  const oneOf = <T extends string>(flag: string, all: readonly T[]): T => {
    // No flag: the first of the list, the default the usage text names.
    const v = flags[flag] ?? all[0];
    const found = all.find((a) => a === v);
    if (found === undefined) throw new Error(`--${flag} is one of: ${all.join(", ")}`);
    return found;
  };
  if (flags.spot !== undefined && !spots.includes(flags.spot)) throw new Error(`--spot is one of: ${spots.join(", ")}`);
  return {
    dir,
    demo: flags.demo,
    spot: flags.spot ?? null,
    time: oneOf("time", TIMES_OF_DAY),
    view: oneOf("view", VIEWS),
    theme: oneOf("theme", THEMES),
    steps: steps.map((text) => ({ text, step: parseStep(text) })),
  };
}
