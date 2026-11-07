// Recorded audio (#306). Every word and sentence the app says is a clip,
// rendered once with Google Chirp 3 HD (scripts/tts/render.ts) and served from
// R2. A clip's name comes from its text, so the app needs no list of clips: it
// works out the name from the text it is about to say. The same text in two
// places is one clip, and an edited sentence gets a new name by itself.

/** What a clip sounds like. Changing any value here gives every clip a new name: a full re-render. @internal Exported for tests. */
export const VOICE = { version: "v1", model: "chirp3-hd", voice: "Charon", speed: 1 } as const;

/** Everything a clip's name depends on. `lang` is the course code ("es"). */
interface ClipInputs {
  version: string;
  model: string;
  voice: string;
  speed: number;
  lang: string;
  text: string;
}

/** Google's name for the voice in a language, e.g. "es-ES-Chirp3-HD-Charon". `tag` is the BCP 47 tag. @internal Only scripts/tts uses it. */
export const voiceName = (tag: string) => `${tag}-Chirp3-HD-${VOICE.voice}`;

/** sha256 of "version|model|voice|speed|lang|NFC(text)", in hex. @internal Exported for tests. */
export async function clipKey(i: ClipInputs): Promise<string> {
  const id = [i.version, i.model, i.voice, i.speed, i.lang, i.text.normalize("NFC")].join("|");
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id)));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

const SLUG_MAX = 40;

/** The text, readable in a file name: "¿Por qué, María?" → "por-que-maria". Decoration only: the hash is the clip's identity. @internal Exported for tests. */
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
export async function clipPath(text: string, lang: string): Promise<string> {
  const key = await clipKey({ ...VOICE, lang, text });
  return `${lang}/${slug(text)}-${key.slice(0, 16)}.mp3`;
}
