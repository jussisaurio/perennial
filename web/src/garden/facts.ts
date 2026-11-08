// The story's facts (#928): what a reader comes to know from the notes, one
// name each. A note lists the facts it tells (`reveals`) and the ones it needs
// the reader to know already (`assumes`). A thought or a frog's line only
// assumes: it never explains the story (#884). facts.test.ts holds the order
// in both courses. The facts name what the story says, not which note says
// it: when the story changes, this list and the tags change with it.

/** @internal Only facts.test.ts reads the meanings: the notes and thoughts use the names. */
export const FACTS = {
  "her-garden": "He lives here with her, and the garden is hers.",
  "dislikes-snails": "He does not like snails. She says that is no reason.",
  "learning-the-language": "He is still learning the language. She says the flowers' names for him.",
  "the-mouse": "A mouse with a name comes through a little door in the hedge and eats their bread.",
  "the-stile": "Every evening they walked to the stile at the end of the garden. Brambles grow there now.",
  "her-chair": "Her wooden chair is too low, but it is hers.",
  "the-far-light": "From the hill past the stile, at night, he watches a light across the valley that never goes out.",
  "she-does-not-ask": "She does not ask him about the far light.",
  "the-quarrel": "The far light is someone he quarrelled with long ago. Neither one has said sorry.",
  "coffee-on-the-hill": "Every night she brings him a coffee up the hill.",
  "she-is-gone": "She has died. He takes his own coffee up the hill.",
  "two-sides": "The garden has her side and his.",
  "her-side": "Now he waters her side of the garden too.",
  "the-snail-friend": "A snail with a name listens to him now.",
  "the-light-answers": "He signalled twice to the far light, and it answered twice.",
  "garden-is-yours": "The garden is now the reader's.",
} as const satisfies Record<string, string>;

export type Fact = keyof typeof FACTS;

/**
 * @internal For facts.test.ts. Facts a line needs that no note tells, each with the issue that decides it.
 * The test fails when a note tells one, so the entry goes then.
 */
export const UNTOLD: Partial<Record<Fact, string>> = {
  // Cold readers could not tell what "your side" was (#920): the garden shows no sides yet.
  "two-sides": "#895 shows her bed in the garden",
};
