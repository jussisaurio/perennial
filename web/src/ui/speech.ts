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

/** Right now: can there be listening exercises? (Sound on, and a voice, assumed while voices still load.) */
export function mayListen(tag: string): boolean {
  return soundOn && typeof speechSynthesis !== "undefined" && (voices.length === 0 || !!pick(tag));
}

export async function hasVoice(tag: string): Promise<boolean> {
  await ready;
  return !!pick(tag);
}

// Bumped by every new request and by stopSpeaking(), so audio that was still
// waiting (for voices, or for the previous part of a sequence) never starts
// after the card it belongs to has gone.
let generation = 0;

/** iPhone and iPad (iPadOS reports itself as a Mac with touch). */
const IOS = typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

/** "Play slowly": iOS squeezes the rate scale, so it needs a lower value to sound clearly slower. */
const SLOW_RATE = IOS ? 0.5 : 0.65;

async function utter(text: string, tag: string, rate: number, gen: number): Promise<void> {
  // WebKit (iOS Safari) ignores a new utterance's settings, rate included, when
  // speak() comes straight after cancel(): stop what is playing, then wait a tick.
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    speechSynthesis.cancel();
    await new Promise((r) => setTimeout(r, 60));
    if (gen !== generation) return; // something newer asked to speak meanwhile
  }
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

/** The sentence again, slowly (the snail buttons). */
export const speakSlowly = (text: string, tag: string) => speak(text, tag, SLOW_RATE);

/** Speak `text`. Does nothing while sound is off. */
export function speak(text: string, tag: string, rate = 1): Promise<void> {
  return speakAll([text], tag, rate);
}

/** Speak the texts one after another. Stops early when stopSpeaking() or another speak call comes first. */
export async function speakAll(texts: string[], tag: string, rate = 1): Promise<void> {
  if (typeof speechSynthesis === "undefined" || !soundOn) return;
  const gen = ++generation;
  await ready;
  for (const text of texts) {
    if (gen !== generation || !soundOn) return;
    await utter(text, tag, rate, gen);
  }
}

export function stopSpeaking(): void {
  generation++;
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
