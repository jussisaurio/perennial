import { expect, jest, mock, test } from "bun:test";

// A clip that never comes: the connection stalled (#754).
mock.module("./clipPlayer", () => ({
  clipsOn: () => true,
  loadClip: () => new Promise<string | null>(() => undefined),
  playClip: async () => true,
  stopClip: () => undefined,
}));

const said: string[] = [];
class Utterance {
  text: string;
  lang = "";
  rate = 1;
  voice: unknown = null;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}
Object.assign(globalThis, {
  SpeechSynthesisUtterance: Utterance,
  speechSynthesis: {
    speaking: false,
    pending: false,
    getVoices: () => [{ lang: "es-ES", name: "Test", localService: true }],
    addEventListener: () => undefined,
    cancel: () => undefined,
    speak: (u: Utterance) => {
      said.push(u.text);
      u.onend?.();
    },
  },
});

test("a stalled clip gives way to the browser voice after a short wait (#754)", async () => {
  jest.useFakeTimers();
  const { speak } = await import("./speech");
  const done = speak("hola", "es-ES");
  jest.advanceTimersByTime(999);
  await Promise.resolve();
  expect(said).toEqual([]);
  jest.advanceTimersByTime(1);
  await done;
  expect(said).toEqual(["hola"]);
  jest.useRealTimers();
});
