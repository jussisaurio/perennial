// The robot learner's run (#1024): started by live.ts, which says how to use it.
//
// One learner uses the app day by day in pinned time: the clock is paused, and the robot
// moves it on as it thinks, so a 5-minute session takes 5 minutes of the app's time and a
// few seconds of ours. A seeded random and a simple memory decide what it does. At every
// screen it checks facts that need no taste; each failed check is a finding.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

import { devices, test, type Browser, type BrowserContext, type Page, type Request } from "@playwright/test";

import { rng } from "../src/lib/seed";
import { longDay } from "../src/ui/format";
import { pinDetail } from "./helpers";
import { LIVE_TZ, parseLive } from "./liveArgs";
import { uiFaults } from "./uiFaults";

const args = process.env.LIVE_ARGS;
if (args === undefined) throw new Error("run this with `bun run live` (e2e/live.ts), not with playwright itself");
const run = parseLive(JSON.parse(args) as string[]);
if (Intl.DateTimeFormat().resolvedOptions().timeZone !== LIVE_TZ) throw new Error(`the run needs TZ=${LIVE_TZ}: start it with bun run live`);

// ---- What the robot knows of the course: the deck, to type a writing card's answer.

type DeckWord = { id: string; lemma: string; gloss: string };
type DeckSentence = { wordId: string; translation: string; cloze: string };
const deck = JSON.parse(readFileSync(new URL("../../decks/es/deck.json", import.meta.url), "utf8")) as { words: DeckWord[]; sentences: DeckSentence[] };
const wordById = new Map(deck.words.map((w) => [w.id, w]));
const lemmas = new Set(deck.words.map((w) => w.lemma));
/** A writing card's answers, by what it shows: the sentence's translation and the word's meaning. */
const writeAnswers = new Map<string, { lemma: string; answer: string }[]>();
const addAnswer = (key: string, a: { lemma: string; answer: string }) => writeAnswers.set(key, [...(writeAnswers.get(key) ?? []), a]);
for (const s of deck.sentences) {
  const w = wordById.get(s.wordId);
  if (!w) throw new Error(`deck sentence for a missing word ${s.wordId}`);
  addAnswer(`${s.translation}|${w.gloss}`, { lemma: w.lemma, answer: s.cloze });
}
// A card with no sentence asks for the word by its meaning.
for (const w of deck.words) addAnswer(`|${w.gloss}`, { lemma: w.lemma, answer: w.lemma });

/** "la casa" → "casa": a new word's card shows the noun with its article. */
const lemmaOf = (headword: string) => (lemmas.has(headword) ? headword : headword.replace(/^\S+ /, ""));

// ---- Time. Day 0 is a Monday in January 2026: in the past, as the server refuses answers from its future.

const at = (day: number, hour: number, minute = 0) => new Date(2026, 0, 5 + day, hour, minute).getTime();
const DAY = 86_400_000;
const hhmm = (t: number) => new Date(t).toTimeString().slice(0, 5);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A finding without its numbers (boxes, seconds, counts): the same fault in another place or day is one kind. */
const shape = (kind: string, detail: string) => `${kind}: ${detail.replace(/\d+(\.\d+)?/g, "#")}`;

/** A wait that never came true: the robot cannot go on from this screen. */
class Stuck extends Error {}

type View = "phone" | "desktop";
const DEVICES: Record<View, (typeof devices)[string]> = { phone: devices["Pixel 7"], desktop: devices["Desktop Chrome"] };

/** What the robot sees on a screen. */
interface Seen {
  screen: "landing" | "today" | "garden" | "words" | "settings" | "card" | "summary" | "session" | "other";
  /** The card's kind (its kicker's class), its word and what it asks: together, which card it is. */
  kicker: string | null;
  key: string | null;
  text: string;
}

interface Finding {
  day: number;
  date: string;
  step: number;
  kind: string;
  detail: string;
  picture: string | null;
}

// The robot's memory of a word: how many days it keeps it (s), and when it last saw it.
type Memory = { s: number; at: number };

class Robot {
  readonly r = rng(run.seed);
  readonly mem = new Map<string, Memory>();
  /** Answers the server should keep: every graded answer and "I knew it", less the ones undone. */
  reviews = 0;
  /** Today's answers: before the first, Today offers the day's practice. */
  answeredToday = 0;
  /** Whether a 5-minute session ran out of time today: then the day's practice is done. */
  fullSessionToday = false;
  day = 0;
  step = 0;
  /** The app's time as the robot plans it: each action happens at a set time, however long the waits took. */
  plan = 0;
  view: View = run.seed % 2 ? "phone" : "desktop";
  context: BrowserContext | null = null;
  page!: Page;
  events: string[] = [];
  /** The page's requests on their way: the clock waits for them (advance). */
  readonly inflight = new Set<Request>();
  readonly findings: Finding[] = [];
  readonly seenKinds = new Set<string>();
  readonly checkedToday = new Set<string>();

  readonly browser: Browser;
  readonly baseURL: string;
  constructor(browser: Browser, baseURL: string) {
    this.browser = browser;
    this.baseURL = baseURL;
  }

  chance(p: number) {
    return this.r() < p;
  }
  between(lo: number, hi: number) {
    return lo + Math.floor(this.r() * (hi - lo + 1));
  }

  log(screen: string, action: string, shown = "") {
    this.step++;
    const line = `${String(this.step).padStart(5)}  d${String(this.day).padStart(3, "0")} ${hhmm(this.plan)} ${this.view.padEnd(7)} ${screen.padEnd(8)} ${action}${shown ? ` → ${shown}` : ""}`;
    appendFileSync(`${run.dir}/diary.txt`, `${line}\n`);
  }

  async find(kind: string, detail: string) {
    const key = shape(kind, detail);
    // The first of each finding gets a picture; the rest say where it came again.
    const first = !this.seenKinds.has(key);
    this.seenKinds.add(key);
    const picture = first ? `finding-${String(this.findings.length).padStart(3, "0")}.png` : null;
    if (picture) await this.page.screenshot({ path: `${run.dir}/${picture}` }).catch((e: unknown) => this.log("-", `no picture: ${String(e).split("\n")[0]}`));
    this.findings.push({ day: this.day, date: new Date(this.plan).toISOString().slice(0, 16), step: this.step, kind, detail, picture });
    this.log("-", `FINDING ${kind}: ${detail}`);
  }

  // ---- The clock: paused, and moved on only by the robot.

  async pageNow() {
    return this.page.evaluate(() => Date.now());
  }

  /**
   * Move the app's clock on by `ms`, a second at a time, each step once the network is quiet.
   * The network takes real time, and the app's clock jumps: without the wait, a request would take
   * as long as the learner thinks.
   */
  async advance(ms: number) {
    for (let left = ms; left > 0; left -= 1000) {
      await this.settle();
      await this.page.clock.runFor(Math.min(1000, left));
    }
  }

  /** Wait in real time until no request of the page is on its way. */
  async settle() {
    const end = Date.now() + 10_000;
    while (this.inflight.size > 0) {
      if (Date.now() > end) {
        await this.find("slow request", `still waiting after 10 s: ${[...this.inflight].map((q) => `${q.method()} ${new URL(q.url()).pathname}`).sort().join(", ")}`);
        // Go on: the request may never end (the server dropped it). Waiting on it again would only stall the run.
        this.inflight.clear();
        return;
      }
      await sleep(5);
    }
  }

  /** Hours away with the tab open (in the background, or a laptop asleep): the clock jumps, and each timer due fires once. */
  async jump(to: number) {
    await this.settle();
    this.plan = to;
    await this.page.clock.pauseAt(to);
  }

  /** Let the app's time run up to the planned time, every timer on the way firing. */
  async think(lo: number, hi: number) {
    this.plan += this.between(lo, hi);
    const now = await this.pageNow();
    if (this.plan > now) await this.advance(this.plan - now);
    else this.plan = now;
  }

  /** Wait until `f` is true. The app's timers (renders after a frame, data updates) need its clock to move: a little each try. */
  async until<T>(what: string, f: () => Promise<T | null | undefined | false>, limitMs = 20_000): Promise<T> {
    const end = Date.now() + limitMs;
    for (;;) {
      const v = await f();
      if (v) return v;
      if (Date.now() > end) throw new Stuck(what);
      await this.advance(50);
      // Real time too, for what the page does off its clock.
      await sleep(20);
    }
  }

  // ---- Pages and devices.

  listen(page: Page) {
    const path = (url: string) => new URL(url).pathname;
    page.on("request", (q) => this.inflight.add(q));
    page.on("requestfinished", (q) => this.inflight.delete(q));
    page.on("requestfailed", (q) => this.inflight.delete(q));
    page.on("console", (m) => {
      // The browser's own echo of a failed request: the response check below says which one.
      if (m.type() === "error" && !/^Failed to load resource: /.test(m.text())) this.events.push(`console error: ${m.text().slice(0, 300)}`);
    });
    page.on("pageerror", (e) => this.events.push(`uncaught: ${String(e).slice(0, 300)}`));
    page.on("crash", () => this.log("-", "the page crashed"));
    page.on("requestfailed", (q) => {
      const why = q.failure()?.errorText;
      // A reload or a closed page cancels what is under way: the robot's doing, not the app's.
      if (why === "net::ERR_ABORTED") return;
      this.events.push(`request failed: ${q.method()} ${path(q.url())} ${why}`);
    });
    page.on("response", (res) => {
      if (res.status() >= 400) this.events.push(`HTTP ${res.status()}: ${res.request().method()} ${path(res.url())}`);
    });
  }

  /** A fresh page at the planned time, as when the learner opens the app; on another device if `view` changed. */
  async open() {
    const state = this.context ? await this.context.storageState() : undefined;
    await this.context?.close();
    // The closed page's requests end with it.
    this.inflight.clear();
    this.context = await this.browser.newContext({ ...DEVICES[this.view], baseURL: this.baseURL, timezoneId: LIVE_TZ, reducedMotion: "reduce", storageState: state });
    // The run has no time limit (live.config.ts): a wait for a thing that never comes stops here, and the robot goes on.
    this.context.setDefaultTimeout(15_000);
    // Speech would speak aloud on macOS, and needs no check here.
    await this.context.addInitScript(() => {
      if ("SpeechSynthesis" in window) SpeechSynthesis.prototype.speak = () => {};
    });
    this.page = await this.context.newPage();
    // Low detail draws the walk fastest in software, the same on every machine.
    await pinDetail(this.page, "low");
    this.listen(this.page);
    await this.page.clock.install({ time: this.plan - 60_000 });
    await this.page.clock.pauseAt(this.plan);
    await this.page.goto("/");
  }

  // ---- Looking: what is on screen, and the checks that need no taste.

  async seen(): Promise<Seen> {
    return this.page.evaluate(() => {
      const q = (s: string) => document.querySelector(s);
      const hash = location.hash;
      // The address changes first, the screen a moment later: a card is still drawn just after End
      // session left it. So the address says whether this is the session, and the page what part.
      const inSession = hash.startsWith("#/session");
      const card = inSession ? q(".session main.card:not(.summary)") : null;
      const kicker = card ? ([...(card.querySelector(".kicker")?.classList ?? [])].find((c) => c !== "kicker") ?? "none") : null;
      const t = (s: string) => card?.querySelector(s)?.textContent?.trim() ?? "";
      const key = card ? `${kicker}|${card.getAttribute("data-lemma") ?? ""}|${t(".word")}|${t(".translation.big")}|${t(".sentence")}` : null;
      const screen = inSession ? (q("main.card.summary") ? "summary" : card ? "card" : "session") : q(".landing-top") ? "landing" : hash.startsWith("#/garden") ? "garden" : hash.startsWith("#/words") ? "words" : hash.startsWith("#/settings") ? "settings" : q(".page.home") ? "today" : "other";
      return { screen, kicker, key, text: document.body.innerText } as const;
    });
  }

  /** The checks for any screen. `kind` names the screen for uiFaults, run once a day per kind. */
  async check(kind: string) {
    for (const e of this.events.splice(0)) await this.find("error", e);
    const s = await this.seen();
    const broken = /\b(undefined|NaN|Infinity)\b|\[object Object\]|\{\{|\}\}/.exec(s.text);
    if (broken) await this.find("broken text", `${kind}: "${s.text.slice(Math.max(0, broken.index - 30), broken.index + 30).replace(/\s+/g, " ")}"`);
    // direction.md: never streaks.
    if (/\bstreak/i.test(s.text)) await this.find("streak", `${kind} talks about a streak`);
    // The server is next door and answers in milliseconds: a write that waits is a bug.
    if (/Not saved yet/.test(s.text)) await this.find("unsent", `${kind}: the app says a write is not saved yet`);
    const tree = await this.page.locator("body").ariaSnapshot();
    const controls = tree.split("\n").flatMap((line) => {
      const m = /^\s*- (button|tab|link|textbox|combobox|radio|checkbox)(?![a-z])(?: "((?:[^"\\]|\\.)*)")?([^:]*)/.exec(line);
      return m ? [{ role: m[1], name: m[2] ?? "", disabled: m[3].includes("[disabled]") }] : [];
    });
    for (const c of controls.filter((c) => c.name === "")) await this.find("no name", `${kind}: a ${c.role} with no name`);
    if (!controls.some((c) => !c.disabled)) await this.find("dead end", `${kind}: no control to go on or back`);
    if (!this.checkedToday.has(kind)) {
      this.checkedToday.add(kind);
      for (const f of await this.ticking(() => uiFaults(this.page, `${kind} (${this.view})`))) await this.find("ui fault", f.replace(/\(\d+(\.\d+)?(px)?\)/g, ""));
    }
    return s;
  }

  /**
   * Run `f` while the app's clock moves 1 ms each 5 ms of real time: axe waits on setTimeout,
   * which the paused clock never fires. (Giving the page its real setTimeout meanwhile broke the
   * app's own timers: one set by one clock and cleared by the other never ends.)
   */
  async ticking<T>(f: () => Promise<T>): Promise<T> {
    let done = false;
    const tick = (async () => {
      while (!done) {
        await this.page.clock.runFor(1);
        await sleep(5);
      }
    })();
    try {
      return await f();
    } finally {
      done = true;
      await tick;
    }
  }

  // ---- Doing.

  /** A stable state of the screen, to tell whether a press changed anything. */
  async fingerprint() {
    return this.page.evaluate(() => `${location.hash}|${document.querySelector(".session")?.getAttribute("data-card") ?? ""}|${document.body.innerText}`);
  }

  /** Press a button, tab or link by its name, and check that it did something. */
  async press(screen: string, name: RegExp, shown = "") {
    const target = this.page.getByRole("button", { name }).or(this.page.getByRole("tab", { name })).or(this.page.getByRole("link", { name })).first();
    // The button's own words: its label's first line, without the key hint and the line under it.
    const label = await target.evaluate((el) => el.getAttribute("aria-label") ?? (el as HTMLElement).innerText.split("\n")[0].trim(), undefined, { timeout: 10_000 });
    const before = await this.fingerprint();
    this.log(screen, `press "${label}"`, shown);
    await target.click({ timeout: 10_000 });
    try {
      await this.until(`"${label}" to change the screen`, async () => (await this.fingerprint()) !== before, 10_000);
    } catch (e) {
      if (!(e instanceof Stuck)) throw e;
      await this.find("dead button", `"${label}" on ${screen} changed nothing`);
    }
  }

  async waitFor(what: Seen["screen"][], limitMs?: number): Promise<Seen> {
    return this.until(`one of: ${what.join(", ")}`, async () => {
      const s = await this.seen();
      return what.includes(s.screen) && s;
    }, limitMs);
  }

  // ---- Today.

  /** Wait for Today with its plan worked out (the line under the start button): the screen is loaded. */
  async todayPlan() {
    await this.waitFor(["today"]);
    return this.until("Today's plan", () =>
      this.page.evaluate(() => {
        const note = document.querySelector(".start-note, .watered")?.textContent?.trim();
        const label = document.querySelector("button.start")?.textContent?.trim();
        return !!note && !!label && { label, date: document.querySelector(".date")?.textContent?.trim() ?? "" };
      }),
    );
  }

  /** Today, checked. Returns the start button's label. */
  async today(): Promise<string> {
    const { label, date } = await this.todayPlan();
    await this.check("today");
    const now = await this.pageNow();
    if (date !== longDay(new Date(now))) await this.find("wrong date", `Today says "${date}", the day is ${longDay(new Date(now))}`);
    if (this.answeredToday === 0 && label !== "Start today's practice") await this.find("new day", `before any practice today, the button says "${label}"`);
    if (this.fullSessionToday && label === "Start today's practice") await this.find("day done", "after a full 5-minute session, Today still offers to start the day's practice");
    return label;
  }

  async words() {
    await this.press("today", /^Words$/);
    await this.waitFor(["words"]);
    await this.check("words");
    await this.wordCount();
    await this.press("words", /^Today$/);
  }

  /** Words' progress line against its list. */
  async wordCount() {
    // The line says how many words are known, or before the first one, how many are being learned.
    // It is shown with the list, unless no word is started yet (Progress.tsx).
    const { line } = await this.until("the word list", () =>
      this.page.evaluate(() => !!document.querySelector(".words-count, .words-empty") && { line: document.querySelector('[aria-label="Your progress"] .progress-line')?.textContent ?? null }),
    );
    const m = line === null ? (["", "are learning", "0"] as const) : /You (know|are learning) (\d+)/.exec(line);
    if (!m) return this.find("count", `Words' progress line has no count: "${line}"`);
    const filter = m[1] === "know" ? "known" : "learning";
    const said = Number(m[2]);
    this.log("words", "read the progress", `${filter} ${said}`);
    await this.page.getByLabel("Which words").selectOption(filter);
    const count = await this.until(`the ${filter} filter`, () =>
      this.page.evaluate(() => {
        const c = document.querySelector(".words-count")?.textContent;
        if (c) return Number(/\d+/.exec(c)?.[0]);
        // An empty list says so in its own line, with no count.
        return document.querySelector(".words-empty") ? 0 : null;
      }).then((n) => (n === null ? null : { n })),
    );
    this.log("words", `filter ${filter}`, `${count.n} words`);
    if (count.n !== said) await this.find("count", `Words says ${filter} ${said}, the ${filter} filter lists ${count.n}`);
    await this.page.getByLabel("Which words").selectOption("all");
  }

  async settings() {
    await this.press("today", /^Settings$/);
    await this.waitFor(["settings"]);
    await this.check("settings");
    await this.press("settings", /^Today$/);
  }

  async garden() {
    // The way in is part of Today's plan: wait until it is worked out.
    await this.todayPlan();
    await this.press("today", /^Walk in your garden$/);
    await this.waitFor(["garden"]);
    await this.until("the walk", () => this.page.evaluate(() => "__garden" in window && document.querySelectorAll(".gw-loading").length === 0));
    await this.check("garden");
    // A few steps forward, then out.
    this.log("garden", "walk forward 2 s");
    await this.page.keyboard.down("ArrowUp");
    await this.think(2000, 2000);
    await this.page.keyboard.up("ArrowUp");
    await this.press("garden", /^Back$/);
    await this.waitFor(["today"]);
  }

  // ---- Practice.

  /** How likely the robot remembers a word now. */
  recallChance(lemma: string) {
    const m = this.mem.get(lemma);
    if (!m) return 0.5;
    return 0.95 * Math.exp(-(this.plan - m.at) / DAY / m.s);
  }

  remember(lemma: string, ok: boolean) {
    const m = this.mem.get(lemma);
    const sameDay = m && this.plan - m.at < DAY / 2;
    const s = !m ? 1 : ok ? (sameDay ? Math.max(m.s, 1) : Math.max(1, m.s * 2.5)) : 0.3;
    this.mem.set(lemma, { s, at: this.plan });
  }

  /**
   * One session, from its first card to its summary. `minutes`: what it promised, when it is
   * a whole chunk (Start or Practice more). Returns how the robot left it.
   */
  async session(minutes: number | null): Promise<"done" | "quit"> {
    let start = await this.pageNow();
    let paused = 0;
    let last: string | null = null;
    let first = true;
    // Per answer: did it write a review, and the word's memory before it (for Undo).
    const answers: { review: boolean; lemma: string | null; before: Memory | undefined; key: string }[] = [];
    for (let n = 0; n < 400; n++) {
      const s = await this.waitFor(["card", "summary"]);
      if (s.screen === "summary") {
        if (first && minutes !== null) await this.find("empty session", "a new chunk opened on its summary, with no card");
        const end = await this.pageNow();
        const sum = await this.check("summary");
        const pausedNow = /Session paused/.test(sum.text);
        const known = /You know (\d+) words?/.exec(sum.text)?.[1];
        this.log("summary", pausedNow ? "paused" : "complete", `${answers.length} answers, ${Math.round((end - start - paused) / 1000)} s${known ? `, knows ${known}` : ""}`);
        if (pausedNow) {
          if (this.chance(0.5)) {
            const left = await this.pageNow();
            await this.think(2000, 8000);
            await this.press("summary", /^Continue this session/);
            paused += (await this.pageNow()) - left;
            const back = await this.waitFor(["card"]);
            if (back.key !== last) await this.find("continue", `Continue showed another card than the one left: ${back.key} after ${last}`);
            // The card left is on screen again: not the same card twice.
            last = null;
            continue;
          }
          await this.press("summary", /^Done/);
          return "quit";
        }
        const active = end - start - paused;
        const emptied = /Every plant has water/.test(sum.text);
        if (minutes !== null && !emptied) {
          if (active < minutes * 60_000 * 0.6 || active > minutes * 60_000 * 1.6) await this.find("session length", `a ${minutes}-minute session took ${Math.round(active / 1000)} s of the app's time`);
          else this.fullSessionToday = true;
        }
        await this.think(3000, 10_000);
        if (this.chance(0.2)) {
          await this.press("summary", /^Practice more/);
          minutes = 5;
          start = await this.pageNow();
          paused = 0;
          first = true;
          last = null;
          answers.length = 0;
          continue;
        }
        await this.press("summary", /^Done/);
        return "done";
      }
      first = false;
      // Once time is up ("finishing"), the retries left come one after another (Session.next): then a card may come twice.
      if (s.key === last && (await this.page.locator(".session-bar .time-left").textContent()) !== "finishing") await this.find("same card", `the same card twice in a row: ${s.key}`);
      last = s.key;
      await this.check(`card ${s.kicker}`);
      // Sometimes the learner leaves in the middle.
      if (answers.length > 0 && this.chance(0.03)) {
        await this.think(1000, 4000);
        await this.press("card", /^End session$/);
        continue;
      }
      if (this.chance(0.01)) {
        this.log("card", "reload the page");
        await this.page.reload();
        const after = await this.waitFor(["card", "today", "summary"]);
        if (after.screen === "today") return "quit";
        // A reload on the session screen starts a fresh 5 minutes (App.tsx, the "/session" route),
        // with nothing to undo: End session then leaves at once, with no summary (useSessionRunner's exit).
        minutes = 5;
        start = await this.pageNow();
        paused = 0;
        last = null;
        answers.length = 0;
        continue;
      }
      const lemmaBefore = await this.answer(s);
      answers.push({ ...lemmaBefore, key: s.key! });
      // Sometimes an answer is a slip: Undo, and the same card comes back.
      if (this.chance(0.04)) {
        const undone = answers.pop()!;
        await this.think(500, 2000);
        const next = await this.waitFor(["card", "summary"]);
        if (next.screen === "card") {
          await this.press("card", /^Undo/);
          const back = await this.waitFor(["card"]);
          if (back.key !== undone.key) await this.find("undo", `Undo showed ${back.key}, not the card answered: ${undone.key}`);
          if (undone.review) this.reviews--;
          this.answeredToday--;
          if (undone.lemma) {
            if (undone.before) this.mem.set(undone.lemma, undone.before);
            else this.mem.delete(undone.lemma);
          }
          // The undone card is on screen again: not the same card twice.
          last = null;
        } else answers.push(undone);
      }
    }
    throw new Stuck("a session of 400 cards");
  }

  /** Answer the card on screen as the robot's memory says. Returns what Undo needs. */
  async answer(s: Seen): Promise<{ review: boolean; lemma: string | null; before: Memory | undefined }> {
    const card = this.page.locator(".session main.card");
    if (s.kicker === "intro") {
      const head = (await card.locator(".word").textContent())!.trim();
      const lemma = lemmaOf(head);
      const before = this.mem.get(lemma);
      await this.think(2000, 6000);
      await this.press("card", /^Show meaning/);
      await this.think(1000, 4000);
      const knew = this.chance(0.12);
      await this.press("card", knew ? /^I knew it/ : /^New to me/, head);
      this.mem.set(lemma, { s: knew ? 20 : 0.3, at: this.plan });
      this.answeredToday++;
      if (knew) this.reviews++;
      return { review: knew, lemma, before };
    }
    const input = card.getByLabel("Type the missing word");
    if (await input.count()) return this.write(input);
    const lemma = (await card.getAttribute("data-lemma"))!;
    const before = this.mem.get(lemma);
    const listen = (await card.getByRole("button", { name: "Can't listen now" }).count()) > 0;
    if (listen && this.chance(0.2)) {
      await this.think(1000, 3000);
      await this.press("card", /^Can't listen now$/);
      return { review: false, lemma: null, before };
    }
    const ok = this.chance(this.recallChance(lemma));
    await this.think(3000, 9000);
    await this.press("card", /^Show answer/);
    await this.think(1000, 3000);
    await this.press("card", ok ? (listen ? /^Understood/ : /^I remembered/) : listen ? /^Did not understand/ : /^I forgot/, lemma);
    this.remember(lemma, ok);
    this.answeredToday++;
    this.reviews++;
    return { review: true, lemma, before };
  }

  async write(input: ReturnType<Page["locator"]>) {
    const card = this.page.locator(".session main.card");
    const shown = await card.evaluate((c) => {
      const t = (sel: string) => c.querySelector(sel)?.textContent?.trim() ?? "";
      return t(".translation.big") ? `${t(".translation.big")}|${t(".hint").replace(/^Meaning: /, "")}` : `|${t(".word")}`;
    });
    const options = writeAnswers.get(shown) ?? [];
    if (!options.length) await this.find("robot", `no answer in the deck for the writing card "${shown}"`);
    const one = new Set(options.map((o) => o.answer)).size === 1;
    const { lemma, answer } = options[0] ?? { lemma: shown, answer: "?" };
    const before = this.mem.get(lemma);
    const ok = this.chance(this.recallChance(lemma));
    const slip = ok ? this.r() : 1;
    // Mostly the answer as it is; sometimes without its accents, or with two letters swapped.
    const bare = answer.normalize("NFD").replace(/\p{M}/gu, "");
    const swapped = answer.length >= 5 ? `${answer.slice(0, 2)}${answer[3]}${answer[2]}${answer.slice(4)}` : answer;
    const typed = !ok ? "zzz" : slip < 0.1 && bare !== answer ? bare : slip < 0.2 ? swapped : answer;
    await this.think(4000, 12_000);
    this.log("card", `type "${typed}"`);
    await input.fill(typed);
    await this.press("card", /^Check/);
    const verdict = await this.until("the check's verdict", () => card.evaluate((c) => (c.querySelector(".feedback .ok") ? "ok" : c.querySelector(".feedback .warn") ? "warn" : c.querySelector(".feedback .bad") ? "bad" : null)));
    const said = (await card.locator(".feedback strong").first().textContent({ timeout: 1000 }).catch(() => null))?.trim();
    if (one && typed === answer && verdict !== "ok") await this.find("write check", `typed the answer "${answer}" exactly, the app said ${verdict}`);
    if (one && typed === "zzz" && (verdict !== "bad" || said !== answer)) await this.find("write check", `typed "zzz" for "${answer}", the app said ${verdict} "${said}"`);
    await this.think(1000, 3000);
    let grade = verdict !== "bad";
    if (verdict === "bad" && this.chance(0.1)) {
      await this.press("card", /^My answer was correct$/);
      grade = true;
    } else if (verdict === "warn" && this.chance(0.2)) {
      await this.press("card", /^Count it as wrong$/);
      grade = false;
    } else await this.press("card", /^Next/);
    this.remember(lemma, grade);
    this.answeredToday++;
    this.reviews++;
    return { review: true, lemma, before };
  }

  // ---- A day.

  /** The server has every answer: wait for the uploads, then compare. */
  async synced() {
    const count = () => this.page.evaluate(async () => ((await (await fetch("/api/rows")).json()) as { review: unknown[] }).review.length);
    try {
      // Uploads retry on a timer: move the clock a second at a time.
      await this.until("the server to have every answer", async () => (await count()) === this.reviews || (await this.advance(1000), false), 20_000);
    } catch (e) {
      if (!(e instanceof Stuck)) throw e;
      await this.find("sync", `the server has ${await count()} answers, the robot gave ${this.reviews}`);
      // Go on from what the server has.
      this.reviews = await count();
    }
  }

  async practise(): Promise<void> {
    const label = await this.today();
    await this.press("today", /^(Start today's practice|Finish today's practice|Practice more)$/, label);
    const minutes = label === "Finish today's practice" ? null : 5;
    if ((await this.session(minutes)) === "quit") {
      // Back later the same day, to finish.
      await this.waitFor(["today"]);
      const back = this.plan + this.between(1, 3) * 3_600_000;
      // Too late to come back today: the robot's next day comes instead.
      if (new Date(back).getDate() !== new Date(this.plan).getDate()) return;
      this.log("today", "away for a while");
      await this.jump(back);
      await this.practise();
      return;
    }
    await this.waitFor(["today"]);
  }

  async live(day: number) {
    this.day = day;
    this.answeredToday = 0;
    this.fullSessionToday = false;
    this.checkedToday.clear();
    this.plan = at(day, this.between(7, 20), this.between(0, 59));
    const other = this.chance(0.15);
    const view = other ? (this.view === "phone" ? "desktop" : "phone") : this.view;
    // The tab left open since yesterday, or the app opened again.
    if (this.context && view === this.view && this.chance(0.25)) {
      this.log("today", "tab left open overnight");
      await this.jump(this.plan);
      // Today's clock line moves on once a minute.
      await this.think(61_000, 61_000);
    } else {
      this.view = view;
      this.log("-", `open the app on the ${view}`);
      await this.open();
    }
    await this.waitFor(["today"]);
    // Before practice, sometimes a look around.
    if (this.chance(0.15)) await this.words();
    if (this.chance(0.08)) await this.settings();
    if (this.chance(0.2)) await this.garden();
    await this.practise();
    if (this.chance(0.15)) await this.garden();
    if (this.chance(0.15)) await this.words();
    await this.synced();
    await this.page.screenshot({ path: `${run.dir}/day-${String(day).padStart(3, "0")}.png` });
  }

  async begin() {
    this.plan = at(0, 9);
    this.log("-", `open the app on the ${this.view}`);
    await this.open();
    await this.waitFor(["landing"]);
    await this.check("landing");
    await this.press("landing", /^Start learning Spanish$/);
    // The account is made when Today shows: only then can another day's page sign in with it.
    await this.waitFor(["today"]);
  }

  writeFindings() {
    writeFileSync(`${run.dir}/findings.json`, `${JSON.stringify(this.findings, null, 1)}\n`);
    const groups = new Map<string, Finding[]>();
    for (const f of this.findings) groups.set(shape(f.kind, f.detail), [...(groups.get(shape(f.kind, f.detail)) ?? []), f]);
    const lines = [...groups.values()].map((fs) => `- ${fs[0].kind}: ${fs[0].detail} — ${fs.length}×, first on day ${fs[0].day} (diary step ${fs[0].step}, ${fs[0].picture})`);
    writeFileSync(`${run.dir}/findings.md`, `# Robot learner: seed ${run.seed}, ${run.days} days\n\n${groups.size} kinds of finding, ${this.findings.length} in all. To see one again: \`bun run live <folder> --seed ${run.seed} --days <its day + 1>\`.\n\n${lines.join("\n")}\n`);
  }
}

test(`live ${run.days} days, seed ${run.seed}`, async ({ browser, baseURL }) => {
  writeFileSync(`${run.dir}/diary.txt`, "");
  const robot = new Robot(browser, baseURL!);
  const started = Date.now();
  await robot.begin();
  let stuck = 0;
  for (let day = 0; day < run.days; day++) {
    // Some days the learner does not come; once in a while not for a week.
    if (day > 0 && robot.chance(0.12)) {
      const away = robot.chance(0.15) ? robot.between(3, 7) : 1;
      robot.day = day;
      robot.log("-", `away for ${away} day${away === 1 ? "" : "s"}`);
      day += away - 1;
      continue;
    }
    try {
      await robot.live(day);
      stuck = 0;
    } catch (e) {
      // The robot could not go on: a finding, then the app opened again from the start.
      await robot.find("stuck", String(e instanceof Error ? e.message : e).split("\n")[0]);
      if (++stuck === 3) break;
      await robot.open();
    }
    robot.writeFindings();
  }
  robot.writeFindings();
  console.log(`${run.days} days in ${Math.round((Date.now() - started) / 1000)} s: ${robot.findings.length} findings in ${run.dir}/findings.md`);
});
