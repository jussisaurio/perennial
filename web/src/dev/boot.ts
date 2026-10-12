// Dev-only URL switches, handled before the app renders.
//   ?demo=es        an anonymous Spanish learner with every deck word studied
//   ?demo=de:120    a German learner with 120 words studied
//   ?demo=off       delete the demo learner

import { DECK_LANGS, type DeckLang } from "../deck/schema";
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
  if (!DECK_LANGS.includes(lang as DeckLang)) return console.warn(`[demo] unknown language "${lang}": use ${DECK_LANGS.join(" or ")}`);
  await seedDemo(lang as DeckLang, n ? Number(n) : Infinity);
  console.info(`[demo] seeded ${lang}`);
}
