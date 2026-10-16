// Which word ids exist: every deck word (retired ones too, so old reviews stay
// valid), per language. Reviews and word states may only point at these or at
// the learner's own words (user_word), so nobody can fill their garden with
// made-up words through the API.

import { join } from "node:path";
import { Context, Effect, Layer, Schema } from "effect";
import { COURSE_LANGS } from "perennial-contract";
import { AppConfig } from "./config";

/** The part of decks/<lang>/deck.json read here. */
const DeckIds = Schema.fromJsonString(Schema.Struct({ words: Schema.Array(Schema.Struct({ id: Schema.String })) }));

/** A course's deck is missing or not a deck: the server cannot check writes, so it does not start. */
export class DeckUnreadable extends Schema.TaggedError<DeckUnreadable>()("DeckUnreadable", { message: Schema.String }) {}

export class Words extends Context.Service<
  Words,
  {
    /** A deck word, in `lang` if given (any language otherwise). */
    readonly isDeckWord: (id: string, lang?: string) => boolean;
    /** A course language (it has a deck). */
    readonly hasDeck: (lang: string) => boolean;
  }
>()("perennial/Words") {}

/** Every course's deck word ids, read once at start. */
export const WordsLive = Layer.effect(
  Words,
  Effect.gen(function* () {
    const { decksDir } = yield* AppConfig;
    const byLang = new Map<string, Set<string>>();
    for (const lang of COURSE_LANGS) {
      const file = join(decksDir, lang, "deck.json");
      const text = yield* Effect.tryPromise({ try: () => Bun.file(file).text(), catch: (e) => new DeckUnreadable({ message: `${file}: ${String(e)}` }) });
      const deck = yield* Schema.decodeUnknownEffect(DeckIds)(text).pipe(Effect.mapError((e) => new DeckUnreadable({ message: `${file}: ${e.message}` })));
      byLang.set(lang, new Set(deck.words.map((w) => w.id)));
    }
    return Words.of({
      isDeckWord: (id, lang) => {
        if (lang) return byLang.get(lang)?.has(id) ?? false; // not a course language: not a deck word
        for (const ids of byLang.values()) if (ids.has(id)) return true;
        return false;
      },
      hasDeck: (lang) => byLang.has(lang),
    });
  }),
);
