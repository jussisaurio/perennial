# Invariants

An invariant is a rule that must always hold. Each one here has an id, one sentence, and the files that check it. The check carries the id, so a machine can match the two:

- In a test, the title starts with the id: `test("sync.review-once: ...")`. One test can check more than one rule: `"a.b, c.d: ..."`.
- In a check that is not one test (a fixture that wraps every test, a script, the robot learner, a type), a comment at the check says `// invariant <id>`.

`scripts/invariants.test.ts` (in `bun run check`) fails when:

- a rule here has no check, or "Checked in" names other files than the ones that carry its id;
- a check carries an id that is in neither this list nor [garden-play.md](garden-play.md);
- a rule says "Not checked yet (#issue)", but a check for it exists.

Each claim in [garden-play.md](garden-play.md) is an invariant too. Its id and its sentence live there, and the same test checks it. They are not copied here.

## Every bug adds one

A bug is a rule that broke. When you fix one, name the rule: an id here or in garden-play.md. If no rule covered it, add one here, with its check. The test for the fix starts with that id, and it fails on the old code.

Use the strongest check that fits: a type that makes the wrong state impossible to write; a database constraint; a property of pure code that the fuzzer or a unit test tries on many inputs; a check on what the scene draws; the robot learner on the whole app.

## The garden

- `garden.walk-rules`: The garden's physical rules (`RULES` in [web/src/fuzz/garden.ts](../web/src/fuzz/garden.ts)) hold in many random gardens. `bun run fuzz:garden` tries more of them. Checked in `web/src/fuzz/garden.test.ts`.
- `garden.drawn-solid`: Each thing drawn as solid stops you. The check reads the scene's tap volumes, so it does not see the things you cannot tap: the stile, the brambles, the well and the shed. Checked in `web/e2e/drawn-solid.spec.ts`.
- `garden.no-invisible-wall`: Where nothing solid is drawn, nothing stops you. Not checked yet (#1124).
- `render.same-outline`: A plant's small sprite and its full-size sprite have the same outline. Checked in `web/e2e/plant-sprites.spec.ts`.
- `render.no-pop`: While you walk, nothing in view jumps in size, shape or place more than the camera's move explains. Not checked yet (#1112).

## The app

- `app.no-console-error`: The app writes no error to the browser console that the test does not expect. Checked in `web/e2e/test.ts`.
- `ui.no-faults`: Every screen, on a phone and a desktop, light and dark, has no mechanical UI fault (the rules in [web/e2e/uiFaults.ts](../web/e2e/uiFaults.ts)). Checked in `web/e2e/ui-faults.spec.ts`.
- `app.robot-clean`: A robot learner who uses the app for 30 days meets none of the faults it looks for (its `find` calls). It runs each night and keeps the issue "Robot learner: findings". Checked in `web/e2e/live.run.ts`.
- `perf.no-long-task`: No main-thread task runs over 10 ms with the CPU slowed 10× ([performance.md](performance.md)). Not checked yet (#421): the app misses this bar today.

## Progress and data

- `progress.never-break`: A change to the planner, FSRS or pacing keeps the progress of a learner in the middle of a course ([direction.md](direction.md), "Never break progress"). Not checked yet (#1113).
- `progress.survives-sign-in`: Progress made before you add an email stays when you sign in, and another device signs in to the same garden. Checked in `web/e2e/hosted.spec.ts`.
- `progress.notes-grow`: The list of the gardener's notes you have read only grows, merged from every device. Checked in `server/test/sync.test.ts`.
- `sync.review-once`: A review sent twice is stored once. Checked in `server/test/sync.test.ts`.
- `sync.batch-whole`: The server stores a batch of writes whole, or refuses all of it. Checked in `server/test/sync.test.ts`.
- `deck.valid`: Each deck fits its schema, its deck.json is built from its source, a second proofreader approved it, and it keeps the words learners study (compatibility with `main`). Checked in `scripts/deck/check.ts`.

## Security and privacy

- `security.own-rows`: You only ever read your own rows. Checked in `server/test/security.test.ts`.
- `security.own-writes`: A write only ever changes the rows of the learner who is signed in. Checked in `server/test/security.test.ts`.
- `privacy.no-secrets`: Logs carry no email, sign-in code or session token. Checked in `server/test/hardening.test.ts`.
- `privacy.no-learner-text`: Logs and traces carry no request body and no text the learner wrote. Not checked yet (#1110).
