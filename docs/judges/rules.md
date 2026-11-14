# Product rules (from the project's CLAUDE.md)

The app is Perennial: a language-learning app (spaced repetition). Each word the learner studies is a plant in a garden. The garden is a small 3D world the learner walks in, first person.

- **Simple English** in all UI text and docs: short sentences, common words. Many learners do not speak English as a first language.
- **Choices predict their outcome.** For side-by-side buttons or options, the labels alone must tell a first-time user how the results differ.
- **Accessibility:** a choice never looks like an action, and a state is never shown by color alone.
- **The garden is physical.** One set of physics everywhere: if there is ground and nothing solid in the way, you can walk there; if something is solid, you can't. You go places by walking (keys, or tapping a spot to walk there around obstacles). No teleports, no tracks, no button that moves you. Anything that looks climbable is climbable; anything that looks open is open. A way that is shut, or the world's edge, is shut by a thing you can see (brambles, a hedge, water), never an invisible wall, so don't show ground we can't let you reach. A button acts on a thing in reach (read, raise, sit), never for travel. The one exception is access: the screen-reader-only Next plant button moves you, because a blind learner can't steer in 3D.
- **Whimsy is quiet.** Small, discoverable details. Never streaks, shaming or confetti, and never in the way of learning.
- **Privacy:** logs and analytics carry ids, counts and short values. Never emails, sign-in codes, request bodies or the learner's text.
