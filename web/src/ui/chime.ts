// A soft chime when a plant is watered or planted (#215). Every word has its
// own note from a five-note (pentatonic) scale, so a session plays a little
// tune of today's words, and any two notes sound fine together.

import { hash32 } from "../lib/seed";
import { isSoundOn } from "./speech";

/** Semitones above the base note: a major pentatonic scale over two octaves. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
/** The base note: A4. */
const BASE_HZ = 440;

/** The word's note, in Hz: the same for the word everywhere. */
export function noteFor(word: string): number {
  const step = SCALE[hash32(word.normalize("NFC").toLowerCase(), 0xc417) % SCALE.length];
  return BASE_HZ * 2 ** (step / 12);
}

let audio: AudioContext | null = null;

/**
 * Called inside the answer's own tap or key press, before anything awaits.
 * Safari lets a page start audio only there; the chime itself plays a moment
 * later. Also wakes audio that iOS paused (a call, the app in the background).
 */
export function wakeAudio(): void {
  if (!isSoundOn()) return;
  audio ??= new AudioContext();
  if (audio.state !== "running") audio.resume().catch((e: unknown) => console.warn("[chime] audio would not start", e));
}

/** Plays the word's note once, quietly, `delay` seconds from now. Only with sound on, after wakeAudio. */
export function chime(word: string, delay = 0): void {
  ring(word, delay, { peak: 0.07, octave: 0.25, fade: 0.9 });
}

/**
 * A plant brushed in the walk (#359): its word's note, softer and shorter
 * than the chime, so a run along a row is a quick run of notes. A bloom rings
 * clear (with its octave); a younger plant sounds soft and plain, so you can
 * hear what you know. Only with sound on, after wakeAudio.
 */
export function brushNote(word: string, clear: boolean): void {
  ring(word, 0, clear ? { peak: 0.045, octave: 0.3, fade: 0.5 } : { peak: 0.025, octave: 0, fade: 0.35 });
}

/** A sine at the word's note and a quiet octave above it (`octave`: its level, 0 for none): a small bell rather than a beep. `fade`: seconds to silence. */
function ring(word: string, delay: number, { peak, octave, fade }: { peak: number; octave: number; fade: number }): void {
  if (!isSoundOn() || !audio) return;
  const now = audio.currentTime + delay;
  const note = noteFor(word);
  const gain = audio.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + fade);
  gain.connect(audio.destination);
  for (const [mult, level] of [
    [1, 1],
    [2, octave],
  ] as const) {
    if (level === 0) continue;
    const osc = audio.createOscillator();
    osc.type = "sine";
    osc.frequency.value = note * mult;
    const g = audio.createGain();
    g.gain.value = level;
    osc.connect(g).connect(gain);
    osc.start(now);
    osc.stop(now + fade + 0.05);
  }
}
