// Recorded audio (#306). Every word and sentence the app says is a clip,
// rendered once with a Google voice (scripts/tts/render.ts) and served from
// R2. A clip's name comes from its text, so the app needs no list of clips: it
// works out the name from the text it is about to say. The same text in two
// places is one clip, and an edited sentence gets a new name by itself.

import type { DeckLang } from "../deck/langs";

/** What a clip sounds like. Changing any value gives every clip with this voice a new name: a re-render. */
export interface Voice {
  version: string;
  model: "chirp3-hd" | "wavenet";
  voice: string;
  speed: number;
}

/** Sentences and phrases: Chirp 3 HD, the most natural voice. */
export const VOICE = { version: "v1", model: "chirp3-hd", voice: "Charon", speed: 1 } as const satisfies Voice;

/**
 * A lone word. Chirp 3 HD has no sentence around it to tell it the language, so it
 * says many the English way (German "Name" as [neɪm], "still" with [st]), or says
 * nothing (#776). A WaveNet voice speaks one language only.
 */
const WORD_VOICE: Record<DeckLang, Voice> = {
  de: { version: "v1", model: "wavenet", voice: "H", speed: 1 },
  es: { version: "v1", model: "wavenet", voice: "E", speed: 1 },
};

const isLoneWord = (text: string) => !/\s/u.test(text.trim());

export const voiceFor = (text: string, lang: DeckLang): Voice => (isLoneWord(text) ? WORD_VOICE[lang] : VOICE);

/** Everything a clip's name depends on. `lang` is the course code ("es"). */
export interface ClipInputs {
  version: string;
  model: string;
  voice: string;
  speed: number;
  lang: string;
  text: string;
}

const GOOGLE_NAME: Record<Voice["model"], (tag: string, voice: string) => string> = {
  "chirp3-hd": (tag, voice) => `${tag}-Chirp3-HD-${voice}`,
  wavenet: (tag, voice) => `${tag}-Wavenet-${voice}`,
};

/** Google's name for the voice in a language, e.g. "es-ES-Chirp3-HD-Charon". `tag` is the BCP 47 tag. */
export const voiceName = (tag: string, v: Voice) => GOOGLE_NAME[v.model](tag, v.voice);

/** sha256 of "version|model|voice|speed|lang|NFC(text)", in hex. */
export async function clipKey(i: ClipInputs): Promise<string> {
  const id = [i.version, i.model, i.voice, i.speed, i.lang, i.text.normalize("NFC")].join("|");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id)));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

const SLUG_MAX = 40;

/** The text, readable in a file name: "¿Por qué, María?" → "por-que-maria". Decoration only: the hash is the clip's identity. */
export function slug(text: string): string {
  const plain = text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    // Combining marks: ñ → n, ü → u.
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (plain.length <= SLUG_MAX) return plain || "x";
  const cut = plain.slice(0, SLUG_MAX + 1);
  const end = cut.lastIndexOf("-");
  // One word longer than the limit: cut inside it.
  return end > 0 ? cut.slice(0, end) : plain.slice(0, SLUG_MAX);
}

/** Where the clip for `text` lives under the audio base URL: "es/por-que-maria-3f9a1c0b2d4e6f81.mp3". */
export async function clipPath(text: string, lang: DeckLang): Promise<string> {
  const key = await clipKey({ ...voiceFor(text, lang), lang, text });
  return `${lang}/${slug(text)}-${key.slice(0, 16)}.mp3`;
}
