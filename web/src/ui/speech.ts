// Browser speech synthesis. Free, offline on most platforms, and covers every
// course language on recent OSes.

// Sound on or off is a per-device choice (where you are matters more than who
// you are), so it lives in localStorage and does not sync.
const SOUND_KEY = "sound";
let soundOn = (() => {
  try {
    return localStorage.getItem(SOUND_KEY) !== "off";
  } catch {
    return true;
  }
})();
const soundListeners = new Set<(on: boolean) => void>();

export const isSoundOn = () => soundOn;

export function setSoundOn(on: boolean): void {
  soundOn = on;
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    // Not saved; it still applies until the page reloads.
  }
  if (!on) stopSpeaking();
  for (const fn of soundListeners) fn(on);
}

export function onSoundChange(fn: (on: boolean) => void): () => void {
  soundListeners.add(fn);
  return () => soundListeners.delete(fn);
}

let voices: SpeechSynthesisVoice[] = [];
const ready = new Promise<void>((resolve) => {
  if (typeof speechSynthesis === "undefined") return resolve();
  const load = () => {
    voices = speechSynthesis.getVoices();
    if (voices.length) resolve();
  };
  load();
  speechSynthesis.addEventListener("voiceschanged", load);
  setTimeout(resolve, 1500);
});

function pick(tag: string): SpeechSynthesisVoice | undefined {
  const lang = tag.toLowerCase();
  const base = lang.split("-")[0];
  const matches = voices.filter((v) => v.lang.toLowerCase().replace("_", "-") === lang);
  const loose = matches.length ? matches : voices.filter((v) => v.lang.toLowerCase().startsWith(base));
  // Prefer higher-quality voices where the platform labels them.
  return loose.find((v) => /premium|enhanced|natural|neural/i.test(v.name)) ?? loose.find((v) => v.localService) ?? loose[0];
}

export async function hasVoice(tag: string): Promise<boolean> {
  await ready;
  return !!pick(tag);
}

/** Speak `text`. Does nothing while sound is off. */
export async function speak(text: string, tag: string, rate = 1): Promise<void> {
  if (typeof speechSynthesis === "undefined" || !soundOn) return;
  await ready;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = tag;
  u.rate = rate;
  const v = pick(tag);
  if (v) u.voice = v;
  return new Promise((resolve) => {
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking(): void {
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
