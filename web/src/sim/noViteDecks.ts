// data/deck.ts loads the decks through Vite (import.meta.glob), which Bun does
// not have. The simulation reads its decks from the files in decks/ instead,
// so that module is stubbed. Import this first, then the simulation with a
// dynamic import(): Bun loads static imports before this plugin is set.

Bun.plugin({
  name: "no Vite decks",
  setup(build) {
    build.onLoad({ filter: /\/data\/deck\.ts$/ }, () => ({
      contents: "const none = () => { throw new Error('no Vite here') }; export const loadDeck = none, loadSentences = none, loadedDeck = none, loadedSentences = none;",
      loader: "ts",
    }));
  },
});
