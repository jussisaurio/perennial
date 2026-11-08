# Perennial: direction

This page is the one source of product direction: what Perennial is, what we build next, and what we do not build. If another doc or an issue disagrees with it, this page wins: fix the other one. How we write code is in [CLAUDE.md](../CLAUDE.md), the architecture in [README.md](../README.md) and [DESIGN.md](../DESIGN.md).

Decided on 2026-11-08. `#n` is a GitHub issue.

## 1. What Perennial is

- A language course of **5 minutes a day**, "zero to fluent". It replaces Anki for language learning ([DESIGN.md](../DESIGN.md)).
- For English speakers who learn **Spain Spanish** or **German**. One learner can have more than one course.
- A spaced-repetition course with a 3D garden that grows as you learn. Every word you learn is a plant.
- One web app (a PWA) for phone and desktop.
- Free. There are no paid plans.
- Pre-alpha. The owner is the only user. It is live at playperennial.com. Section 5 says when it opens to more people.

## 2. The learning core

**Memory.**
- FSRS-6 keeps one memory per word and skill. The skills are read, listen and write. There are two grade buttons.
- The app works out every memory by replaying the review log (`web/src/core/memory.ts`).
- A word is **known** when its reading memory has a stability of 7 days or more and at least 2 reps (`KNOWN_RULE`, `web/src/core/memory.ts`). Every gate in the garden uses this one measure.
- **Listening and typing also count for reading** (#856). A remembered listening or typing answer counts as a Good reading review at that time. A forgotten one is not a reading lapse (`readingGrade`, `web/src/core/memory.ts`). So listening and typing practice also move a word toward known.
- The listening and writing memories on their own never open anything in the garden. They are goals for the planner, not story gates. A learner who never types still gets the whole story, and a phone user is not punished.

**Time.**
- Every learner gets a fixed 5 minutes a day (`DAILY_MINUTES`, `web/src/data/practice.ts`, #189). There is no minutes setting. The only learning setting is the retention slider.
- **Never limit use.** "Practice more" always works. Nothing stops or discourages practice. The planner steers without showing it.

**Planner** (`web/src/core/session.ts`).
- A chunk fills in this order: due reviews, new words, reviews due within a day, then the weakest known words.
- Up to 2 due reading reviews in a chunk come as their word's first listening practice, and 1 as its first typing practice (`FIRST_PRACTICES`). The answer waters reading too.
- **Never break progress.** A change to scheduling (planner, FSRS, pacing, story thresholds) keeps the progress of learners who are partway through. Plan and test the transition.

**Decks.**
- Static decks that ship with the app: about 2000 live words each (es 2036, de 2043). Words come in frequency order, with garden and orchard words placed early ([docs/decks.md](decks.md)).
- Every deck change has an author and a different proofreader. CI checks this.

**When the words run out.** After the last new word, the planner keeps going with the weakest words, so 5 minutes and "Practice more" still work. Today shows one line: "You have planted every word in this course." The plants keep growing, but the story adds nothing more.

**Grammar** is never taught on purpose. It comes from sentences, from the forms on each plant (shake it), and from the el/la fix (#289). A grammar track would be a second product.

**Audio** is recorded clips (Google Chirp 3 HD, served from R2), with browser speech only for text that has no clip (`web/src/content/clips.ts`). #735 tracks turning it on in production.

**AI** is optional.
- The course itself uses no AI at runtime.
- The AI features are mining words from your own text and new example sentences (`/api/ai/mine`, `/api/ai/examples`). They need an email account, use a monthly allowance, and stop for everyone at a hard global budget (`MONTHLY_BUDGET_USD`).
- Every model provider goes behind the one `Model` adapter (`server/src/model.ts`). We never run two SDKs side by side.
- AI readers and writing feedback (#748) come after the launch.

## 3. The garden

**Role.** The garden is where the whimsy and the story live. The UI copy stays plain. It has two views: a 2D strip on Today, and a 3D walk in a retro pixel style. The beds fill in the order you planted the words, and a bed never moves once it exists (#641).

**Physics.** The rules are in [CLAUDE.md](../CLAUDE.md), "The garden is physical". You go places only by walking. Solid things stop you. Every edge is a thing you can see. Visitors walk; nothing teleports. The wall clock sets the time of day (#646).

**The verbs** ([docs/garden-play.md](garden-play.md)): walk, sit on the bench (time passes), shake a plant to see its forms, brush the beds, carry things, throw a pebble, blow a dandelion clock, open the door with its key, read the notes in the shed, climb the stile and the hill, and signal to the far light with the hill's lantern. The glint is only late help (#689). Verbs are never gated by word counts.

**The story** (#639). You are alone in a garden someone else kept. Their notes tell you who they were. The gardener also came from far away and learned this language here.
- **The theme:** love is kept by small daily tending, like a garden, and a few minutes a day is a lot. It is shown in the couple's rituals and never stated. It is never aimed at the learner's own practice (#639).
- The beats, in order: early, the stile, the lookout, late, and the door.
- **The facts** (#928). Each note lists the story's facts it tells and the ones it needs. A thought or the frog only needs them. No line needs a fact before a note has told it, and both courses tell the same facts in the same beats (`web/src/garden/facts.ts`, `facts.test.ts`).
- The notes are only in the course language, with no translation. When a note appears, most of its words are known (`web/src/garden/notes/notes.test.ts`). Each course has 3–5 words of the gardener's own that no deck teaches.
- **Notes, places and visitors open by known words, never by days.** A break never costs anything.
- **Pacing.** A note comes about every 3–4 weeks for a learner who does 5 minutes a day. The thresholds come from a simulation of that learner, not from the deck's size. Long gaps are filled by world changes, not by more notes. (Retune not done yet: #883.)
- **Density** (#932). A learner who does 5 minutes a day finds something new about once a week. There are three kinds:
  - **big beats:** the notes;
  - **small beats:** a thought or a change in the world that follows a note's beat and shows it without words;
  - **texture:** details that build the place and its people but are not part of the plot, like the neighbour's dog, the goat, or what the valley is like. They are deadpan and strange, as in Disco Elysium, where not every detail serves the main story.
  Texture keeps the same art style and the same dry voice. It never crowds out the story. It is writing and things to look at, not new toys or verbs (#640).
- **The story loop** (#928). The pacing and the text are tuned by simulated learners and fresh readers ([docs/story-loop.md](story-loop.md)). Nothing in this section is fixed, even the beats, if the loop finds something better. What stays fixed is the theme and the product rules.

**The ending.** The mouse door opens when the learner knows about 90% of the deck's words. The last note, "the door" note, is behind it. Then the garden keeps growing but adds no more story (#882).

**Garden words change the world.** Six garden words, and only six, change the world when they become known: lluvia, luna, nieve, búho, zorro, erizo (rain, moon, snow, owl, fox, hedgehog; the same in German). Each one only adds something to the world, with no new verb, and they are placed to fill the gaps between notes. In practice, one small flash, the same for all six, plays when such a word becomes known. Today only the visitor words (cat, bird, dog, frog, fish, snail, butterfly) do something. (Not built yet: #209.)

**Thoughts** (#864). Tap a thing, and a short line in the course language shows under its name, made only of words the learner knows. A thought may be on any thing, not only a thing from the story. Each thought on an ordinary thing is poignant with a hint of the story, a quiet deadpan joke, or a strange detail that builds the world. Never a plain fact. A thought never explains the story and never uses the gardener's own words. (#884, #889.)

**Whimsy is quiet**: small details you find, never streaks, shaming or confetti, and never in the way of learning.

## 4. Product rules

The rules that code review checks are in [CLAUDE.md](../CLAUDE.md), "Product rules". Also:
- **Never limit use** and **never break progress** (section 2).
- **Premium look**: check phone and desktop, light and dark, before merging UI ([docs/agents.md](agents.md)).
- **Performance**: no main-thread task over 10 ms at 10× CPU slowdown ([docs/performance.md](performance.md)). The app misses this bar today (#421).
- **The repo is public**: no secrets or exploit recipes in issues or commits.

## 5. Launch

The launch is a soft opening to friends, for Spanish and German. The tracking issue is #885. We launch when:
1. the launch essentials are done (#16);
2. there are no open P1 garden bugs;
3. the main screens (Today, a session, the garden) meet the performance bar;
4. the ending is built (#882).

Until then, work that moves the launch comes before new garden features.

## 6. Scope

### In now (built, or being fixed)
- The FSRS course for es and de: three skills, a fixed 5 minutes, "Practice more", the retention slider.
- The two decks of about 2000 words, with the proofreader process.
- Recorded audio (#735).
- Optional AI for mining and examples, for email accounts, under a budget.
- Start without an account, then keep progress with an email code. More than one course per learner.
- The garden: the strip and the walk, beds in planting order, visitors, the door and key, the notes, the stile, the hill, the diary, the far light, pebbles, dandelion clocks, the glint and thoughts.
- The ending: the mouse door and its last note, and the course-end line on Today (#882).
- The landing page with a walk you can only look at (#14).
- "Give this seed to a friend", the only way to share (#652 makes the link show the flower).
- Open garden and accessibility bugs, and the performance debt (#421 and the issues it links).

### In later (decided, not built)
- Note thresholds retuned for 5 minutes a day (#883).
- Six garden words change the world, with one practice flash (#209).
- AI readers and writing feedback, after the launch (#748).
- Product events (#127).
- Two seeds, one pot (#387). On hold.
- Growing the decks past about 2000 words (#73). The ending moves with the deck, because it is a share of it.

### Out
- **Offline mode and storage on the device.** One online path is simpler, and the learner never sees a stale state (#188, #810).
- **A minutes setting.** One fixed 5 minutes plus "Practice more" is easier to understand (#189).
- **Paid plans.** There are no users to charge yet.
- **Local models and the learner's own AI keys.** Too much setup for a language learner.
- **Anki import, AnkiConnect, adding words by hand, sync codes.** The course is a curated deck, not a card manager.
- **A placement test.** The first words go fast anyway (#258).
- **Grammar lessons.** Grammar stays in sentences and forms (section 2).
- **New languages before the launch.** The story makes each one much more work than a deck. The full cost is in [docs/decks.md](decks.md), "Adding a language".
- **The other 13 garden words changing the world.** Six come first, and the rest wait until those six prove their worth.
- **Story gates on listening or writing.** They would punish phone users and change the pace for learners partway through.
- **Story gates by days or garden age.** Learners go at different speeds, and a break must cost nothing.
- **Sharing beyond the seed gift**: the postcard (#71), feeds, friends, leaderboards. Self-promotion works against quiet whimsy and privacy.
- **Streaks, badges, confetti, shame and jokey UI copy** (#711). They work against quiet learning.
- **Teleports, travel buttons and invisible walls.** The garden is physical.
- **Call or whistle, fetch, the bowl and shelf of finds, the paper boat, the mushroom, the cairn and the stick** (#640, #835). Toys with no part in the story.
- **Speech recognition, the FSRS optimizer and FSRS-7.** FSRS-6 with its defaults is enough for now.
