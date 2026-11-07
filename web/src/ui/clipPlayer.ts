// Recorded clips (#306): the app's words and sentences, said by one voice
// (content/clips.ts names them). Loaded ahead of time into memory, and played
// on one reused <audio> element. Off until VITE_AUDIO_BASE_URL is set at build
// time: until then, and for any text without a clip, the browser speaks.

import { clipPath } from "../content/clips";
import { COURSE_LANGUAGES } from "../content/languages";
import { reportClipFailed } from "../observability";

// `||`: an empty build argument means no clips, the same as none.
const BASE = (import.meta.env.VITE_AUDIO_BASE_URL as string | undefined) || undefined;

export const clipsOn = () => BASE !== undefined;

function courseOf(tag: string): string {
  const l = COURSE_LANGUAGES.find((x) => x.tag === tag);
  // Every caller speaks a course's own tag (language(code).tag).
  if (!l) throw new Error(`no course speaks ${tag}`);
  return l.code;
}

const keyOf = (text: string, tag: string) => `${tag}|${text.normalize("NFC")}`;

/** Each clip asked for: its blob URL, or null when it has none (the browser says it then). */
const loaded = new Map<string, Promise<string | null>>();

async function fetchClip(text: string, tag: string): Promise<string | null> {
  const lang = courseOf(tag);
  let res: Response;
  try {
    res = await fetch(`${BASE}/${await clipPath(text, lang)}`);
  } catch {
    // Offline or a dropped connection: asked again next time, not kept as missing.
    loaded.delete(keyOf(text, tag));
    reportClipFailed("network", lang);
    return null;
  }
  if (!res.ok) {
    // 404: a text with no clip, such as the frog's croak with a word after it.
    reportClipFailed(`HTTP ${res.status}`, lang);
    return null;
  }
  return URL.createObjectURL(await res.blob());
}

/** The clip for `text`, from memory or fetched now. */
export function loadClip(text: string, tag: string): Promise<string | null> {
  const k = keyOf(text, tag);
  let p = loaded.get(k);
  if (!p) {
    p = fetchClip(text, tag);
    loaded.set(k, p);
  }
  return p;
}

/** Clips fetched at the same time ahead of need, so they do not slow the one asked for now. */
const AHEAD_AT_ONCE = 3;
let wanted: { text: string; tag: string }[] = [];
let busy = 0;

function pump(): void {
  while (busy < AHEAD_AT_ONCE && wanted.length) {
    const { text, tag } = wanted.shift()!;
    if (loaded.has(keyOf(text, tag))) continue;
    busy++;
    void loadClip(text, tag).finally(() => {
      busy--;
      pump();
    });
  }
}

/** Loads the clips for texts about to be said, in order. Replaces what an earlier call still had waiting. */
export function prefetchClips(texts: readonly string[], tag: string): void {
  if (!BASE) return;
  wanted = texts.map((text) => ({ text, tag }));
  pump();
}

let audio: HTMLAudioElement | undefined;
/** Ends the clip's wait in playClip: it ended, failed, or was stopped. */
let finish: (() => void) | undefined;

/**
 * A silent WAV, played inside the first tap or key press. iOS lets a page play
 * an element later, after awaits, only once it has played inside a gesture.
 */
function unlock(): void {
  const wav = new DataView(new ArrayBuffer(46));
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => wav.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  wav.setUint32(4, 38, true);
  ascii(8, "WAVEfmt ");
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true); // PCM
  wav.setUint16(22, 1, true); // mono
  wav.setUint32(24, 8000, true);
  wav.setUint32(28, 16000, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  ascii(36, "data");
  wav.setUint32(40, 2, true);
  const a = (audio ??= new Audio());
  a.src = URL.createObjectURL(new Blob([wav.buffer], { type: "audio/wav" }));
  // A refusal here changes nothing: playClip then fails and the browser speaks.
  a.play().catch(() => undefined);
}

if (BASE && typeof document !== "undefined") {
  const first = () => {
    document.removeEventListener("pointerdown", first, true);
    document.removeEventListener("keydown", first, true);
    unlock();
  };
  document.addEventListener("pointerdown", first, true);
  document.addEventListener("keydown", first, true);
}

/** Plays a loaded clip to its end. False when it would not play: the browser says the text instead. */
export async function playClip(url: string, rate: number): Promise<boolean> {
  finish?.();
  const a = (audio ??= new Audio());
  a.src = url;
  a.preservesPitch = true;
  a.playbackRate = rate;
  try {
    await a.play();
  } catch (e) {
    // Expected, not faults: NotAllowedError, no tap yet this page load; AbortError, stopped or replaced before it started.
    if (!(e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "AbortError"))) reportClipFailed("play");
    return false;
  }
  await new Promise<void>((resolve) => {
    finish = resolve;
    a.onended = a.onerror = () => resolve();
  });
  return true;
}

export function stopClip(): void {
  audio?.pause();
  finish?.();
}
