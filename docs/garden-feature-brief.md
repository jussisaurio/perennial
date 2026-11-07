# Shared brief for garden feature agents (Perennial, 2026-10-17)

The user's goal now: **"focus heavily on implementing a lot of fun features, that's the primary goal… ramp up the velocity."** The app is pre-alpha. Ship fast and well.

## Read first
- Repo CLAUDE.md (code standard; **the new lighter review rule**). DESIGN.md "Garden code" (Part = rendering technique; the host owns every order table: TAP_PRIORITY, LABEL_PRIORITY, reportReach; tick allocates nothing; behaviour gets time only from the frame/conditions; seeded hashes, never Math.random/Date in behaviour).
- GitHub #335: the roadmap, the verbs, the cut and its rules. Also #324 (kinds as data), #334 (one action button, no instruction text).
- web/src/garden/* and web/src/ui/GardenWalk.tsx, useGardenScene.ts.
- To open the walk directly in a browser, go to `/?demo=es:200#/garden` (a demo learner with 200 words) or `#/garden`.

## Product rules
- **Fun to *do*:** hands-on verbs, surprise, a payoff, a reason to do it twice.
- **Quiet whimsy:** no streaks, scores, FOMO, confetti, nags, timers or currency. Nothing withers or is lost.
- **Never asks the learner to practise.** More words make more material to play with; never gate a verb behind a word count.
- **No instruction text in the walk (#334).** The world shows what can be done. The one action button is icon-only, but its accessible name says the action.
- **The wall clock sets the time of day (#646).** There is no button for it. Night things are a quiet surprise for someone who comes at night.
- **Phones:** one thumb, sound off. Anything that relies on sound has a visual half.
- **Screen readers:** each verb works through the action button with a name, plus a short status line.
- **Simple English** for any text. Course-language words get `lang` and are never quizzed.
- **Privacy:** `garden_action` counts verbs by name only.
- **Art:** match the retro pixel style in visitorArt.ts / carryArt.ts / textures.ts. Use shared atlases where they fit.

## Process
Setup, checks, merging and the report are in [agents.md](agents.md). Specific to garden features:
1. File your own GitHub issue (labels `garden` + P2) with a short design and why it's fun.
2. Unit tests for pure logic take a pinned `now`. Write one e2e for the main moment: import `test` from "./test", pin the clock and the viewport, pick the hour for day, evening or night, and pin the detail to low (`pinDetail` in e2e/helpers.ts). Garden specs keep passing on desktop and iPhone.
3. Your report says what a learner can now do.
