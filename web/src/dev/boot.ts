// Dev-only URL switches, handled before the app renders.
//   ?demo=es        a Spanish demo course with every demo word studied
//   ?demo=de:120    a German demo course with 120 words studied
//   ?demo=off       remove all demo courses

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
  if (lang !== "es" && lang !== "de") return console.warn(`[demo] unknown language "${lang}": use es or de`);
  const id = await seedDemo(lang, n ? Number(n) : Infinity);
  console.info(`[demo] seeded ${id}`);
}
