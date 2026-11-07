// Speech: recorded clips when the build has them (clipPlayer.ts), and browser
// speech synthesis for any text without one. Browser speech is free, offline on
// most platforms, and covers every course language on recent OSes.

import { clipsOn, loadClip, playClip, stopClip } from "./clipPlayer";

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
  return listenOn(Date.now()) && (clipsOn() || (typeof speechSynthesis !== "undefined" && (voices.length === 0 || !!pick(tag))));
}

// "Can't listen now" pauses listening for an hour (#716): long enough for a bus
// ride, short enough that listening comes back the same day. Per device, like sound.
const LISTEN_PAUSE_KEY = "listen-paused-until";
const LISTEN_PAUSE_MS = 3_600_000;

export function pauseListening(now: number): void {
  try {
    localStorage.setItem(LISTEN_PAUSE_KEY, String(now + LISTEN_PAUSE_MS));
  } catch {
    // Not saved: the chunk under way still drops its listening cards.
  }
}

/** Sound on, and listening not paused: a session planned at `now` may have listening cards. */
export function listenOn(now: number): boolean {
  if (!soundOn) return false;
  try {
    // Number(null) is 0: never paused.
    return Number(localStorage.getItem(LISTEN_PAUSE_KEY)) <= now;
  } catch {
    // No storage: no pause was saved.
    return true;
  }
}

export async function hasVoice(tag: string): Promise<boolean> {
  if (clipsOn()) return true;
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
/** "Play slowly" for a clip: the recording played slower, at the same pitch. Much below this it starts to smear. */
const SLOW_CLIP_RATE = 0.75;

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

/** One text: its clip, or the browser's voice when it has none or the clip will not play. */
async function say(text: string, tag: string, slow: boolean, gen: number): Promise<void> {
  if (clipsOn()) {
    const url = await loadClip(text, tag);
    if (gen !== generation) return;
    if (url && (await playClip(url, slow ? SLOW_CLIP_RATE : 1))) return;
    if (gen !== generation) return;
  }
  if (typeof speechSynthesis === "undefined") return;
  await ready;
  if (gen !== generation) return;
  await utter(text, tag, slow ? SLOW_RATE : 1, gen);
}

/** The sentence again, slowly (the snail buttons). */
export const speakSlowly = (text: string, tag: string) => sayAll([text], tag, true);

/** Speak `text`. Does nothing while sound is off. */
export const speak = (text: string, tag: string) => sayAll([text], tag, false);

/** Speak the texts one after another. Stops early when stopSpeaking() or another speak call comes first. */
export const speakAll = (texts: string[], tag: string) => sayAll(texts, tag, false);

async function sayAll(texts: string[], tag: string, slow: boolean): Promise<void> {
  if (!soundOn) return;
  const gen = ++generation;
  for (const text of texts) {
    if (gen !== generation || !soundOn) return;
    await say(text, tag, slow, gen);
  }
}

export function stopSpeaking(): void {
  generation++;
  stopClip();
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}
