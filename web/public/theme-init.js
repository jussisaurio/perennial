// Apply the saved theme before the page paints (no flash of the wrong colours).
// A separate file, not inline, so the Content Security Policy can forbid inline scripts.
try {
  var t = localStorage.getItem("perennial-theme");
  document.documentElement.dataset.theme = t === "light" || t === "dark" ? t : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
} catch {}
