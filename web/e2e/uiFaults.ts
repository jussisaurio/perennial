// Mechanical UI faults, read from the page itself (#977): the faults that need no taste to
// see. A screenshot judge misses about half of the owner's problems and stops most fixed
// versions (docs/judges.md), so only these checks are a gate.
//
// The rule for every check here: no false alarms. A check reports only what cannot be a
// meant design. Where it cannot tell (a list that scrolls, text cut with "…", a collapsed
// panel), a stated rule in the code leaves the case out. There is no list of ignored elements.
//
// Not checked, because the page cannot tell: a course word without `lang` (#692), a state
// shown by colour alone (#693), a control hidden under a bar on another layer, and the
// 44 px we aim for on main controls (the page does not say which controls are main; the
// 24 px floor of docs/accessibility.md rule 4 is checked, by axe's target-size).

import { AxeBuilder } from "@axe-core/playwright";

import type { Page } from "./test";

/** Left, top, right, bottom on the page (CSS pixels). */
type Box = [number, number, number, number];

interface DomFault {
  rule: "page-scrolls-sideways" | "text-cut" | "text-overflows-box" | "off-screen" | "controls-overlap";
  element: string;
  box: Box;
  detail: string;
}

/** Runs in the page. Self-contained: Playwright sends its source text. */
function domFaults(): DomFault[] {
  // Boxes are compared with 1 px of slack: sub-pixel layout rounds either way.
  const SLACK = 1;
  const faults: DomFault[] = [];
  const seen = new Set<string>();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;

  const box = (r: { left: number; top: number; right: number; bottom: number }): Box => [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
  const short = (s: string) => {
    const t = s.replace(/\s+/g, " ").trim();
    return t.length > 40 ? `${t.slice(0, 40)}…` : t;
  };
  const ROLES: Record<string, string> = { A: "link", BUTTON: "button", SELECT: "combobox", TEXTAREA: "textbox", INPUT: "input", SUMMARY: "button" };
  /** Role and name for a control, or a short selector and the text for anything else. */
  const describe = (el: Element): string => {
    const role = el.getAttribute("role") ?? (el instanceof HTMLInputElement ? el.type : ROLES[el.tagName]);
    const label = el.getAttribute("aria-label") ?? (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement ? [...(el.labels ?? [])].map((l) => l.innerText).join(" ") : (el as HTMLElement).innerText);
    if (role !== undefined) return `${role} "${short(label)}"`;
    const cls = typeof el.className === "string" && el.className !== "" ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
    return `${el.tagName.toLowerCase()}${cls} "${short(label)}"`;
  };
  const add = (rule: DomFault["rule"], el: Element, b: Box, detail: string) => {
    const key = `${rule}|${describe(el)}|${b.join(",")}`;
    if (seen.has(key)) return;
    seen.add(key);
    faults.push({ rule, element: describe(el), box: b, detail });
  };

  /** Drawn at all: not display:none, hidden, fully transparent, or the 1 px box of screen-reader-only text. */
  const drawn = (el: Element): boolean => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) return false;
    // .sr-only cuts its whole box away, however big a button's padding makes it (the garden's Next plant, #1024).
    if (getComputedStyle(el).clipPath === "inset(50%)") return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };

  type Clip = { el: Element; x: "cut" | "scroll" | null; y: "cut" | "scroll" | null; left: number; top: number; right: number; bottom: number };
  /**
   * The ancestors that clip an element, nearest first, each with its padding box. "scroll": the
   * rest is reached by scrolling, so it is meant. Follows CSS: an absolute box is clipped only from
   * its containing block up, and a fixed box by nothing.
   */
  const clips = (from: Element): Clip[] => {
    const out: Clip[] = [];
    let needPositioned = false;
    for (let a: Element | null = from; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const skipped = needPositioned && cs.position === "static" && cs.transform === "none";
      if (!skipped) {
        needPositioned = false;
        const kind = (v: string): Clip["x"] => (v === "hidden" || v === "clip" ? "cut" : v === "auto" || v === "scroll" ? "scroll" : null);
        const [x, y] = [kind(cs.overflowX), kind(cs.overflowY)];
        if ((x || y) && cs.display !== "inline" && cs.display !== "contents") {
          const r = a.getBoundingClientRect();
          out.push({ el: a, x, y, left: r.left + a.clientLeft, top: r.top + a.clientTop, right: r.left + a.clientLeft + a.clientWidth, bottom: r.top + a.clientTop + a.clientHeight });
        }
      }
      if (cs.position === "fixed") break;
      if (cs.position === "absolute") needPositioned = true;
    }
    return out;
  };
  /** The box that keeps the element put while the page scrolls: the nearest ancestor (or itself) with a position in `kinds`. */
  const layerOf = (el: Element, kinds: string[]): Element | null => {
    for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) if (kinds.includes(getComputedStyle(a).position)) return a;
    return null;
  };
  const fixedLayer = (el: Element) => layerOf(el, ["fixed"]);

  // 1. The page itself scrolls sideways.
  if (document.documentElement.scrollWidth > vw + SLACK) add("page-scrolls-sideways", document.documentElement, [0, 0, document.documentElement.scrollWidth, vh], `the page is ${document.documentElement.scrollWidth} px wide in a ${vw} px viewport`);

  /** Partly past the viewport's edge. Wholly outside is a parked panel, which is meant. Up and down count only on a fixed layer: the rest of the page scrolls. */
  const offScreen = (el: Element, r: DOMRect, cl: Clip[]) => {
    // Inside a box that scrolls or clips sideways: that box decides what shows, not the viewport.
    if (!cl.some((c) => c.x)) {
      const part = r.right > 0 && r.left < vw;
      if (part && (r.left < -SLACK || r.right > vw + SLACK)) add("off-screen", el, box(r), `leaves the ${vw} px wide viewport sideways`);
    }
    if (fixedLayer(el) && !cl.some((c) => c.y)) {
      const part = r.bottom > 0 && r.top < vh;
      if (part && (r.top < -SLACK || r.bottom > vh + SLACK)) add("off-screen", el, box(r), `on a fixed layer, and leaves the ${vh} px tall viewport up or down`);
    }
  };

  // 2. Text: cut by a box that does not scroll, spilling out of its own box, or off the screen.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || node.nodeValue === null || node.nodeValue.trim() === "") continue;
    // A form control draws and scrolls its own text; SVG text has no CSS box.
    if (parent.closest("select, textarea, script, style, noscript, svg")) continue;
    if (!drawn(parent)) continue;
    const cl = clips(parent);
    // Screen-reader-only text sits in a clipped 1 px box (or under clip-path): not drawn, so never cut.
    if (cl.some((c) => c.right - c.left <= 1 || c.bottom - c.top <= 1) || parent.closest("[class*=sr-only], [class*=visually-hidden]")) continue;
    const fontSize = parseFloat(getComputedStyle(parent).fontSize);
    range.selectNodeContents(node);
    // The box that holds the text: the nearest ancestor that is not inline.
    let holder: Element = parent;
    while (getComputedStyle(holder).display === "inline" && holder.parentElement) holder = holder.parentElement;
    const hs = getComputedStyle(holder);
    const hr = holder.getBoundingClientRect();
    for (const r of range.getClientRects()) {
      if (r.width <= 0 || r.height <= 0) continue;
      // A line's box is taller than its letters when the line height is under about 1.2. Compare the
      // letters (one font size, in the middle of the line), so a tight heading is not called cut.
      const lead = Math.max(0, (r.height - fontSize) / 2) + SLACK;
      // A box that marks its cut with "…" or a line clamp meant it.
      const meant = (s: CSSStyleDeclaration) => s.textOverflow === "ellipsis" || (s.webkitLineClamp !== "none" && s.webkitLineClamp !== "");
      let hidden = false;
      for (const c of cl) {
        const inX = r.right > c.left && r.left < c.right;
        const inY = r.bottom > c.top && r.top < c.bottom;
        // Wholly outside a clipping box: a closed panel or a parked slide, hidden on purpose.
        if ((c.x === "cut" && !inX) || (c.y === "cut" && !inY)) hidden = true;
        // Past the edge of a scrolling box: reached by scrolling. Boxes farther up cannot be judged from here.
        if ((c.x === "scroll" && (r.left < c.left || r.right > c.right)) || (c.y === "scroll" && (r.top < c.top || r.bottom > c.bottom))) hidden = true;
        if (hidden) break;
        const cs = getComputedStyle(c.el);
        if (meant(cs) || meant(hs)) continue;
        if (c.x === "cut" && (r.left < c.left - SLACK || r.right > c.right + SLACK)) add("text-cut", parent, box(r), `cut sideways by ${describe(c.el).split(" ")[0]} [${box(c).join(",")}]`);
        if (c.y === "cut" && (r.top + lead < c.top || r.bottom - lead > c.bottom)) add("text-cut", parent, box(r), `cut up or down by ${describe(c.el).split(" ")[0]} [${box(c).join(",")}]`);
      }
      if (hidden) continue;
      // Spilling: the holder lets its text show past its own edge. Only when the holder has a box of its own to be
      // out of (a background or a border): text past the edge of a bare box looks no different from text inside it.
      const boxed = hs.backgroundColor !== "rgba(0, 0, 0, 0)" || hs.backgroundImage !== "none" || parseFloat(hs.borderTopWidth) + parseFloat(hs.borderBottomWidth) + parseFloat(hs.borderLeftWidth) + parseFloat(hs.borderRightWidth) > 0;
      if (boxed && hs.overflowX === "visible" && hs.overflowY === "visible" && (r.left < hr.left - SLACK || r.right > hr.right + SLACK || r.top + lead < hr.top || r.bottom - lead > hr.bottom))
        add("text-overflows-box", parent, box(r), `spills out of its box [${box(hr).join(",")}]`);
      offScreen(parent, r, cl);
    }
  }

  // 3. Controls: off the screen, or one over another.
  const modal = document.querySelector("dialog:modal");
  const controls = [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link], [role=radio], [role=checkbox], [role=switch], [role=menuitem], [role=option], [role=slider]")]
    // An open modal dialog makes the rest of the page inert: only its own controls can be used.
    .filter((el) => drawn(el) && !el.closest("[inert]") && (!modal || modal.contains(el)))
    .flatMap((el) => {
      const cl = clips(el);
      const r = el.getBoundingClientRect();
      // The part that shows: what every clipping or scrolling ancestor leaves of it.
      const shown = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      for (const c of cl) {
        if (c.x) [shown.left, shown.right] = [Math.max(shown.left, c.left), Math.min(shown.right, c.right)];
        if (c.y) [shown.top, shown.bottom] = [Math.max(shown.top, c.top), Math.min(shown.bottom, c.bottom)];
      }
      if (shown.right - shown.left <= 1 || shown.bottom - shown.top <= 1) return [];
      offScreen(el, r, cl);
      // Controls are compared only within one layer: a fixed or sticky bar lies over the page on purpose, and the page
      // scrolls under it (a long summary's links pass under its sticky .actions, #1024). A sticky bar cannot hide what
      // comes before it for good: at the end of the scroll it sits below it.
      return [{ el, shown, layer: layerOf(el, ["fixed", "sticky"]), scroller: cl.find((c) => c.x === "scroll" || c.y === "scroll")?.el ?? null }];
    });
  const isField = (el: Element) => el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["checkbox", "radio", "range", "button", "submit", "file", "color"].includes(el.type));
  for (let i = 0; i < controls.length; i++)
    for (let j = i + 1; j < controls.length; j++) {
      const [a, b] = [controls[i], controls[j]];
      if (a.layer !== b.layer || a.scroller !== b.scroller) continue;
      // One inside the other in the page's tree is one target with parts (a row that is a button, an input in its label).
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.shown.right, b.shown.right) - Math.max(a.shown.left, b.shown.left);
      const h = Math.min(a.shown.bottom, b.shown.bottom) - Math.max(a.shown.top, b.shown.top);
      // 2 px: joined buttons may share a 1 px border.
      if (w < 2 || h < 2) continue;
      // A small button wholly inside a text field (clear, show the password) is a meant design.
      const inside = (s: typeof a, f: typeof a) => isField(f.el) && s.shown.left >= f.shown.left && s.shown.right <= f.shown.right && s.shown.top >= f.shown.top && s.shown.bottom <= f.shown.bottom;
      if (inside(a, b) || inside(b, a)) continue;
      add("controls-overlap", a.el, box(a.shown), `${Math.round(w)} x ${Math.round(h)} px under or over ${describe(b.el)} [${box(b.shown).join(",")}]`);
    }

  return faults;
}

/**
 * The mechanical faults on the page now, one line each:
 * `<screen> | <rule> | <element> | box l,t,r,b | <what is wrong>`.
 * `screen` names the screen, the device and the theme. An empty list is a clean page.
 */
export async function uiFaults(page: Page, screen: string): Promise<string[]> {
  const dom = await page.evaluate(domFaults);
  // WCAG 2.2 A and AA: names, roles, contrast, and the 24 px target floor.
  // Only `violations`: what axe cannot decide (text over a picture) it lists as "incomplete", and we leave it.
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const lines = dom.map((f) => `${screen} | ${f.rule} | ${f.element} | box ${f.box.join(",")} | ${f.detail}`);
  for (const v of axe.violations)
    for (const n of v.nodes) {
      // One frame and no shadow DOM in this app: the first selector names the element.
      const selector = String(n.target[0]);
      const r = await page.locator(selector).first().boundingBox();
      const b = r ? [r.x, r.y, r.x + r.width, r.y + r.height].map(Math.round).join(",") : "none";
      const why = [...n.any, ...n.all, ...n.none].map((c) => c.message)[0] ?? v.help;
      lines.push(`${screen} | axe ${v.id} | ${selector} | box ${b} | ${why.replace(/\s+/g, " ")}`);
    }
  return lines;
}
