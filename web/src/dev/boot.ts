// Demo URL switches, handled before the app renders. In every build (#751):
// they never write into a real account (demo.ts).
//   ?demo                 a list of story points to jump to (Jump.tsx)
//   ?demo=es              an anonymous Spanish learner with every deck word studied
//   ?demo=de:120          a German learner with 120 words studied
//   ?demo=es:known:620    a Spanish learner who knows exactly 620 words: a story point
//   ?demo=off             delete the demo learner

import type { ComponentType } from "react";
import { DECK_LANGS, isDeckLang } from "../deck/langs";
import type { DemoSize } from "perennial-contract";

/** The page to show instead of the app (the story points), or null to open the app. */
export async function devBoot(): Promise<ComponentType | null> {
  const params = new URLSearchParams(location.search);
  const demo = params.get("demo");
  if (demo === null) return null;
  // The list stays in the address, so it can be bookmarked and opened again.
  if (demo === "") return (await import("./Jump")).default;
  // Imported only here: without ?demo, the app's code loads as it would anyway (main.tsx).
  const { removeDemo, seedDemo } = await import("./demo");
  params.delete("demo");
  const rest = params.toString();
  history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + (location.hash || "#/today"));
  if (demo === "off") {
    await removeDemo();
    return null;
  }
  const [lang, a, b] = demo.split(":");
  if (!isDeckLang(lang)) {
    console.warn(`[demo] unknown language "${lang}": use ${DECK_LANGS.join(" or ")}`);
    return null;
  }
  // No count: every deck word.
  const size: DemoSize = a === "known" ? { known: Number(b) } : a ? { studied: Number(a) } : {};
  // The app renders after this: a failed seed is reported, not a blank page.
  await seedDemo(lang, size).then(
    () => console.info(`[demo] seeded ${lang}`),
    (e: unknown) => console.error(`[demo] could not seed ${lang}:`, e),
  );
  return null;
}
