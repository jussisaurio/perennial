# How the garden plays

One section for each thing the learner can do in the garden walk. Each section is prose, written as the learner meets it: what they see, how they can tell what to do, each thing they can do and what happens, and what they can't do and how they can tell.

A feature's section is written and reviewed for friction before the feature is built, and kept true when it changes (CLAUDE.md, "Before merge"; docs/agents.md, "Play description review").

## The text becomes the tests

After the prose, each section lists its claims: short, checkable sentences, each with an id, for example:

- `stile.walk-over`: With n08 unlocked, holding W walks you up the stile's steps and down the other side.

Each claim has one e2e test whose title starts with its id, and the test plays it with the keyboard like the learner would. A claim that has no test is a missing test. A garden test that names no claim is either a claim missing from this file or a test to delete.

## Calling a visitor

With nothing in reach, the action button shows a whistle, and its name is "Call". Press it, or press and hold on open ground, to whistle. Each visitor you can see answers in its own way, and a screen reader hears what each one did.

The dog comes. It gets up from its place by the shed and runs to you, wagging its tail. It goes the way you would walk: round the beds, round the pond, and through the door in the hedge when you are in the orchard. It never goes over or through them. It stops a short way from you and sits there for a few seconds. Then it trots home the same way and sits down in its place again. It runs to where you stood when you whistled: if you walk off, you find it waiting there. Whistle again and it comes to you again, from wherever it is.

Everywhere you can stand, the dog can reach on foot: the door in the hedge never shuts once it is open, and before that you cannot be on the far side of it. If a later change makes a place you can stand that the dog cannot reach, the dog comes as near as it can and waits there; that change must say so here.

The cat almost never comes: it flicks one ear. Rarely, it gets up and walks over the same way the dog does, stops the same short way from you, and stares at you until you walk away. The heron takes one slow step back from you, and never into the pond. The other visitors answer where they are: they fly, swim, or call back.

Visitors never stand in your way: you can walk through them. You never have to wait for one: walk on whenever you like.

- `call.dog-round`: With a bed between you and the dog, the dog runs round the bed to you and is never on the bed.
- `call.dog-home`: A few seconds after it reaches you, the dog trots back to its own place by the shed, again never over a bed.
