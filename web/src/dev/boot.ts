// Dev-only URL switches, handled before the app renders.
//   ?demo=es        an anonymous Spanish learner with every deck word studied
//   ?demo=de:120    a German learner with 120 words studied
//   ?demo=off       delete the demo learner

import { DECK_LANGS, isDeckLang } from "../deck/schema";
import { removeDemo, seedDemo } from "./demo";

export async function devBoot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const demo = params.get("demo");
  if (demo === null) return;
  params.delete("demo");
  const rest = params.toString();
  history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + (location.hash || "#/today"));
  if (demo === "off") return removeDemo();
  const [lang, n] = demo.split(":");
  if (!isDeckLang(lang)) return console.warn(`[demo] unknown language "${lang}": use ${DECK_LANGS.join(" or ")}`);
  // The app renders after this: a failed seed is reported, not a blank page.
  await seedDemo(lang, n ? Number(n) : Infinity).then(
    () => console.info(`[demo] seeded ${lang}`),
    (e: unknown) => console.error(`[demo] could not seed ${lang}:`, e),
  );
}
