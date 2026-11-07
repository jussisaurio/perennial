# How the garden plays

One section for each thing the learner can do in the garden walk. Each section is prose, written as the learner meets it: what they see, how they can tell what to do, each thing they can do and what happens, and what they can't do and how they can tell.

A feature's section is written and reviewed for friction before the feature is built, and kept true when it changes (CLAUDE.md, "Before merge"; docs/agents.md, "Play description review").

## The text becomes the tests

After the prose, each section lists its claims: short, checkable sentences, each with an id, for example:

- `stile.walk-over`: With n08 unlocked, holding W walks you up the stile's steps and down the other side.

Each claim has one e2e test whose title starts with its id, and the test plays it with the keyboard like the learner would. A claim that has no test is a missing test. A garden test that names no claim is either a claim missing from this file or a test to delete.
