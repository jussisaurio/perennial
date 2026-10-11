// Bot check (Cloudflare Turnstile) before creating an anonymous user or
// sending a sign-in code. Off unless VITE_TURNSTILE_SITE_KEY is set at build
// time. Most people never see it; a suspicious browser gets a small challenge.

interface Turnstile {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
let script: Promise<Turnstile> | undefined;

function load(): Promise<Turnstile> {
  script ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("bot check did not load")));
    s.onerror = () => {
      script = undefined;
      reject(new Error("bot check did not load"));
    };
    document.head.append(s);
  });
  return script;
}

/** Headers for a protected auth request: a fresh one-use token, or none when the check is off. */
export async function captchaHeaders(): Promise<Record<string, string>> {
  if (!SITE_KEY) return {};
  const turnstile = await load();
  const box = document.createElement("div");
  box.className = "captcha";
  document.body.append(box);
  let id = "";
  try {
    const token = await new Promise<string>((resolve, reject) => {
      id = turnstile.render(box, {
        sitekey: SITE_KEY,
        appearance: "interaction-only",
        callback: resolve,
        "error-callback": () => reject(new Error("bot check failed")),
        "expired-callback": () => reject(new Error("bot check expired")),
      });
    });
    return { "x-captcha-response": token };
  } finally {
    if (id) turnstile.remove(id);
    box.remove();
  }
}
