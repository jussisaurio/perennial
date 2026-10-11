// Light / dark / system theme. The resolved theme lives on <html data-theme>,
// set before first paint by the inline script in index.html.

export type ThemePref = "system" | "light" | "dark";
const KEY = "perennial-theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function apply(pref: ThemePref) {
  const dark = pref === "dark" || (pref === "system" && media.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#10130e" : "#f3eee4");
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    /* private mode: still apply for this session */
  }
  apply(pref);
}

export function initTheme() {
  apply(getThemePref());
  media.addEventListener("change", () => apply(getThemePref()));
}
