// The look tool's run (#974): started by look.ts, which says how to use it. It opens the app
// as the arguments say, runs each step, and after each one writes <n>-<step>.png and
// <n>-<step>.json (the state: LookState below) to the folder.

import { writeFileSync } from "node:fs";

import type { SceneState } from "../src/garden/sceneState";
import { gameSeconds, pinDetail } from "./helpers";
import { parseRun, type Run, type Step } from "./lookScript";
import { frames, openToday, openWalk, SPOTS, TIMES, walkReady } from "./spots";
import { expect, test, type Page } from "./test";

const args = process.env.LOOK_ARGS;
if (args === undefined) throw new Error("run this with `bun run look` (e2e/look.ts), not with playwright itself");
const run: Run = parseRun(JSON.parse(args) as string[], Object.keys(SPOTS));

/** Left, top, right, bottom on the page (CSS pixels). */
type Box = [number, number, number, number];

/** What one state file holds. */
interface LookState {
  step: string;
  url: string;
  viewport: { width: number; height: number };
  /** The garden walk, or null on any other screen. Angles are radians; forward is −z at yaw 0. */
  garden:
    | (Omit<SceneState, "things"> & {
        /** The action button's name, or null when nothing is in reach (or a card is open). */
        action: string | null;
        /** The scenery in view, nearest first: a nearer thing may cover a farther one where their boxes meet. */
        things: { name: string; box: Box; metres: number }[];
        /** The words drawn over the garden: plant names, tags, lines. `kind` is the element's CSS class. */
        labels: { text: string; kind: string; box: Box }[];
      })
    | null;
  /** The buttons, tabs, links, radios and checkboxes in the accessibility tree, with their state ("[pressed]", "[disabled]"). */
  buttons: { role: string; name: string; state: string }[];
  /** The page's visible text, line by line. */
  text: string[];
  /** console.error lines and uncaught errors since the last state file. */
  consoleErrors: string[];
}

const gardenNow = (page: Page) =>
  page.evaluate(() => {
    const g = (window as unknown as { __garden?: { stateNow(): SceneState } }).__garden;
    const cv = document.querySelector(".gw-canvas")?.getBoundingClientRect();
    if (!g || !cv) return null;
    const px = (v: number) => Math.round(v);
    const s = g.stateNow();
    return {
      ...s,
      action: document.querySelector(".gw-act")?.getAttribute("aria-label") ?? null,
      things: s.things.map((t) => ({ name: t.name, box: [px(cv.left + t.box[0] * cv.width), px(cv.top + t.box[1] * cv.height), px(cv.left + t.box[2] * cv.width), px(cv.top + t.box[3] * cv.height)] as [number, number, number, number], metres: Math.round(t.metres * 100) / 100 })),
      labels: [...document.querySelectorAll(".gw-labels > *")].map((el) => {
        const r = el.getBoundingClientRect();
        // innerText: the text as drawn. textContent would run a tag's word and its meaning together.
        return { text: (el as HTMLElement).innerText.replace(/\s+/g, " ").trim(), kind: el.className, box: [px(r.left), px(r.top), px(r.right), px(r.bottom)] as [number, number, number, number] };
      }),
    };
  });

async function stateNow(page: Page, step: string, errors: string[]): Promise<LookState> {
  const tree = await page.locator("body").ariaSnapshot();
  const buttons = tree.split("\n").flatMap((line) => {
    const m = /^\s*- (button|tab|link|radio|checkbox)(?![a-z])(?: "((?:[^"\\]|\\.)*)")?([^:]*)/.exec(line);
    // A control with no name in the tree is a finding too: its name is "".
    return m ? [{ role: m[1], name: m[2] ?? "", state: m[3].trim() }] : [];
  });
  const text = await page.evaluate(() =>
    document.body.innerText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== ""),
  );
  // The viewport is always set: each project uses a device (shots.config.ts).
  return { step, url: page.url(), viewport: page.viewportSize()!, garden: await gardenNow(page), buttons, text, consoleErrors: errors.splice(0) };
}

/** Is the walk on screen? A step may have just opened it (a click on "Walk in your garden"): then wait until it is all there. */
const onWalk = async (page: Page): Promise<boolean> => {
  if (new URL(page.url()).hash !== "#/garden") return false;
  await walkReady(page);
  return true;
};

const inGarden = async (page: Page, text: string) => {
  if (!(await onWalk(page))) throw new Error(`"${text}": this step needs the garden walk. Start with --spot, or click "Walk in your garden" first`);
};

const WAIT = { timeout: 60_000 };

async function doStep(page: Page, text: string, step: Step) {
  switch (step.kind) {
    case "hold": {
      await inGarden(page, text);
      for (const k of step.keys) await page.keyboard.down(k);
      await gameSeconds(page, step.seconds);
      for (const k of step.keys.toReversed()) await page.keyboard.up(k);
      return;
    }
    case "press":
      return page.keyboard.press(step.key);
    case "tap": {
      if ("x" in step.at) return page.mouse.click(step.at.x, step.at.y);
      const { name } = step.at;
      const g = await gardenNow(page);
      const hit = g?.things.find((t) => t.name === name) ?? g?.labels.find((l) => l.text === name);
      if (!hit) throw new Error(`"${text}": nothing named "${name}" is in view. In view: ${[...new Set([...(g?.things ?? []).map((t) => t.name), ...(g?.labels ?? []).map((l) => l.text)])].join(", ")}`);
      return page.mouse.click((hit.box[0] + hit.box[2]) / 2, (hit.box[1] + hit.box[3]) / 2);
    }
    case "click": {
      const named = { name: step.name, exact: true };
      return page.getByRole("button", named).or(page.getByRole("tab", named)).or(page.getByRole("link", named)).first().click();
    }
    case "wait": {
      const u = step.until;
      if ("text" in u) return expect(page.getByText(u.text).first()).toBeVisible(WAIT);
      await inGarden(page, text);
      if ("seconds" in u) return gameSeconds(page, u.seconds);
      await page.waitForFunction(
        (u) => {
          const s = (window as unknown as { __garden: { stateNow(): SceneState } }).__garden.stateNow();
          return "mode" in u ? s.mode === u.mode : s.reach === u.reach;
        },
        u,
        WAIT,
      );
      return;
    }
    default:
      return step satisfies never;
  }
}

test.use({ colorScheme: run.theme });

test(`look ${run.demo}`, async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  const snap = async (n: number, text: string) => {
    // In the garden, the scene draws what a step changed on the next frame, and the page's own parts (a card, the
    // action button) follow it a frame later: with only two frames the picture was one frame behind the state file.
    if (await onWalk(page)) {
      await frames(page);
      await frames(page);
    }
    const file = `${run.dir}/${String(n).padStart(2, "0")}-${text.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    await page.screenshot({ path: `${file}.png` });
    const state = await stateNow(page, text, errors);
    writeFileSync(`${file}.json`, `${JSON.stringify(state, null, 1)}\n`);
    const g = state.garden;
    const where = g ? `${g.mode} at x ${g.x.toFixed(2)} z ${g.z.toFixed(2)} yaw ${g.yaw.toFixed(2)} · action: ${g.action ?? "none"}` : new URL(state.url).hash;
    console.log(`${file}.png · ${where} · ${state.consoleErrors.length} console errors`);
  };

  await page.clock.setFixedTime(TIMES[run.time]);
  // Normal detail, as most learners see it, whatever this machine's frame times.
  await pinDetail(page, "normal");
  if (run.spot === null) await openToday(page, run.demo);
  else {
    await openWalk(page, run.demo, "as it is");
    await SPOTS[run.spot](page);
  }
  await snap(0, "start");
  for (const [i, { text, step }] of run.steps.entries()) {
    try {
      await doStep(page, text, step);
    } catch (e) {
      // The picture and the state at the step that failed say why (a wait that never came true, a name not in view); then the run fails.
      await snap(i + 1, `failed ${text}`);
      throw e;
    }
    await snap(i + 1, text);
  }
});
