# Tracker

Every question, suggestion, and piece of food for thought from Jussi, with its
status. Updated as items are addressed.

Status: **done** · **in progress** · **open** · **answered** (question, no code change)

## Requests & suggestions

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Reimplement Anki: research annoyances, legacy cruft, learning research, UI and sync gaps; interview me | done | `DESIGN.md`. Interview answers saved to memory. |
| 2 | Are there embeddable local LLMs good enough? Evaluate their quality | done | No, not as the content source. I tested 8 models (Qwen3.5 2B/4B/9B, Gemma 4 E2B/E4B, Ministral 3 3B/8B, Qwen3-4B) in 5 languages. The best (Qwen3.5-9B, Gemma 4 E4B) still have roughly 15–40% learner-invisible errors, worst at the beginner level. Full report: `eval/RESULTS.md`. The app now warns when a local model is picked. |
| 3 | Make the UI awesome: 2026 look, artistic whimsy, without sacrificing UX | done | Word-garden concept, paper/ink + night-garden themes, theme switch. |
| 4 | Rename the app; lean on the garden | done | **Perennial**. The folder is still `ankee/`. |
| 5 | What's the difference between "I know this" and "Got it"? | done | Relabelled to "Already know it" / "Continue", so "Got it" only means "remembered". |
| 6 | "What does it mean?" should name the word | done | "What does **por** mean?". Listening asks about the sentence (naming the word would give it away). |
| 7 | Aren't the sentences nonsensical (conjunction labelled as a noun)? | answered | That was the mock LLM. Mock output is now labelled `[mock]`. Real-model quality is tracked in #2. |
| 8 | "Learn it" does nothing / doesn't teach | done | The intro card is the lesson. Now: a "Continue" button plus a hint, a "quick check · new word" label on the follow-up, and a seed pop. |
| 9 | UX review pass: predict → interact → verify for every control | done | 27 findings below, all fixed and covered by the e2e suite (#10). |
| 10 | Turn the review into a browser e2e suite (if worthwhile) | done | `web/e2e/` (Playwright + mock LLM + sync server). 15 tests, ~12s: `cd web && bun run e2e`. |
| 11 | Can the user switch between a local model and OpenAI/Anthropic without breaking the app? | done | Mostly yes: content is stored independently of the provider, the config is read per request, and a failed switch keeps the old connection (e2e-tested). Three breakages found and fixed: no output limit (some local servers cut JSON off at 512 tokens), no timeout (a hung model spun forever, now 3 min), and local "thinking" models (now asked not to think; a thinking-only reply is also read). Remaining caveats: the AI config is per device (by design, so keys never sync), and content quality changes with the model, so a weaker model's words mix in. |
| 12 | Should there be pregenerated "default sets" made with frontier models? (question) | answered | Yes. It's the backbone of the hosted free tier (see #18). A one-time batch job of roughly $60 per language buys near-zero cost per user, and the local-model eval so far shows small models can't produce trustworthy beginner content. Final model numbers will follow #2. |
| 13 | Track my questions and suggestions explicitly | done | This file. |
| 14 | "Remove complexity / clutter" pass: progressive disclosure, minimal path dead simple | done | Home: the garden plus one progress sentence, with stats and activity under "More progress"; the language picker only appears with 2+ courses. Settings: advanced options folded away. Onboarding: detected native language shown as text with "Change". Add words: example sentence and Anki import folded away. Word detail: "+ Add a note" instead of an empty field. |
| 16 | Does the session clock tick while I'm in another tab watching cat videos? | done | It did (wall clock). Now an active-time clock: it pauses when the tab is hidden or after 45s idle. The same clock measures answer times. `core/clock.ts`, tested. |
| 17 | "Add" in the navbar is unclear; find a better name | done | Removed the tab. Words now has an "Add words" button, so the nav is Today · Words · Settings. |
| 18 | Hosted mode with free and paid tiers: what would users pay for, what makes them subscribe, and how to keep the free tier affordable with no runaway cost? | done | Built: email-code accounts, Perennial AI (Anthropic SDK with structured outputs, task endpoints only), credits per plan, global spend limit, rate limits, a shared course cache, Stripe Checkout, Portal and signed webhooks, account sync. Tested locally: server suite (Stripe SDK against stripe-mock) and e2e (sign-up → course → out of credits → checkout → webhook → Pro). Not built yet: stories, natural audio, writing feedback (the other paid features). |
| 19 | Figure out the most efficient way to bootstrap the static (shared) content | open | Later. Groundwork: hosted course batches are already deterministic and cached per language pair and position, so a one-time batch job (Batch API, 50% off) can pre-fill exactly the same cache table. |
| 20 | Learning screen: "Already know it" vs "Continue" is meaningless. How did it pass the language/UX review? | done | It passed because the copy pass checked words and the UX pass checked single controls; neither asked whether two choices side by side predict *different outcomes*. Planned fix: ask "Is this word new to you?" with answer buttons that carry their consequence ("New to me · quick check soon" / "I knew it · back in about a week"). Done: "Is this word new to you?" with "I knew it · Skip the quick check. Back in about a week." / "New to me · Learn it now. A quick check comes in a moment.", plus a confirmation after "I knew it". Review method updated (memory). |
| 21 | Have two Opus subagents review the UX as personas: a Gen X mom and a tech-savvy Hacker News reader | done | Merged into R1–R30 below: 24 fixed, 6 partly fixed (remaining parts noted). Covered by the e2e suite (22 tests). |
| 22 | Why is "I speak" a free-text field? | done | It was a shortcut: the name went straight into AI prompts unchecked ("Englsh" would silently degrade content). Removed with the MVP scope (#23). The native language is now fixed to English. |
| 23 | Shrink the MVP: English as the source language, Spanish and German as targets | done | Onboarding offers two choice cards. The server refuses other pairs, which bounds AI spend and the shared cache. Answer checking knows Spanish ñ and German ae/oe/ue/ss spellings, and treats an umlaut swap (Mutter/Mütter) as wrong. |
| 24 | Re-evaluate local model competence on Spanish and German | done | Still not good enough. Gemma 4 E4B ~30% flawed entries, Ministral 3 8B ~35% where it answers (unusable output 7/10 times), Qwen3.5-9B ~40–45%. Errors include classic learner mistakes taught as correct. Stopped before Qwen3.5-4B finished (weakest last round). Details in `eval/RESULTS.md` (follow-up section). |
| 25 | Be lenient with the Spanish tilde (hard to type): accept "ano" for "año" with a warning colour, like Duolingo | done | Missing tildes and accents count as correct. The feedback turns amber and the letters to fix are highlighted in the correct answer. German too (agreed after review): a missing umlaut is accepted with the same amber warning, and ae/oe/ue/ss are fully correct. Also added a guard: a "target word" far longer than the word itself (one model marked whole sentences) is recomputed from the sentence. |
| 26 | What user-specific (not shared) data is stored now, and where? | answered | Inventory in chat (browser IndexedDB / localStorage, server SQLite, third parties). Gaps 1–3 fixed (#29); 4–5 (encryption at rest, plain-text API key in the browser) noted, not changed. |
| 29 | Fix privacy gaps 1–3: deleted data lingering on the server, no deletion for sync-code users, sessions never expiring | done | Server forgets anything deleted for 30+ days (its history, plus a word's sentences and reviews; a course's words), keeping a minimal tombstone. Daily housekeeping. Sync-code users can erase their server data (Settings → Sync). Sessions expire after 90 idle days. Server tests added. |
| 30 | Lean into the garden: a performant virtual list, plus a retro 3D garden (flat sprite plants, Paper Mario/Doom style) you can walk through, with plots | done | **List:** Words uses a window virtualizer (no 300-row cap; 1,500+ words keep fewer than 60 rows in the page). **Garden:** new Garden tab (#/garden) and a "Walk in your garden" link on Today. Each word's own procedural plant is rasterised into sprite atlases and drawn as camera-facing billboards in raised beds, one kind of word per row of beds (nouns, verbs, …), most common words nearest the gate. Retro rendering: a small framebuffer scaled up with hard pixels, unlit pixel-art textures, banded sky, fog, hill ring. Pixel-art pond, bench, fence and arch, trees, tufts, mushrooms, butterflies by day, lanterns, light pools and fireflies at night. Day, evening and night follow the clock, with a toggle. Walk with WASD/arrows, drag to look, or use the thumb stick on touch. Names float over nearby plants. Click a plant (or Next/Previous) for its card with Listen. Thirsty plants lean, with a "Water N thirsty plants" button that starts a session. Respects reduced motion. Falls back to a message without WebGL. three.js loads lazily (204 kB gzip). Layout unit tests and 3 e2e tests. |
| 31 | How do I try the garden? Can local dev mode have a fake dataset where X words are already learned? | done | Dev-only demo courses: open `?demo=es:150` (or `de`, or no count for all; `?demo=off` removes them), or use Settings → Developer tools. Real Spanish (~330) and German (~240) words with meanings and kinds of word, and a simulated 90-day FSRS review history: sprouts, buds, blooms, and ~1 in 6 words that stopped getting practice (thirsty). Written straight to IndexedDB, not the op log, so it never syncs. Removed from production builds. 2 e2e tests. |
| 32 | Garden too grainy on a MacBook; two-finger trackpad should pan the camera | done | The framebuffer now uses a whole number of device pixels per game pixel, so every pixel is the same size and crisp on retina screens. The default is finer (about 1440 px wide, before about 460; the user asked for the finer level as Medium), and a HUD button switches Big/Medium/Small pixels, remembered per browser. Plant sprites are rasterised at 96×192 (before 64×128). Trackpad: two-finger swipe looks around, pinch walks forward and back, and the page never scrolls. e2e covers it. |
| 33 | Next plant: the camera ends up looking down a bit instead of straight ahead | done | The glide aimed at a fixed 18° down. It now aims at the plant's flower head (clamped between about 10° down and 3° up), eased on the same curve as the walk, so the view is nearly level and the plant sits above the card. Also: the garden stats now use the UI font, because in the pixel font "5" looked like "8". |
| 34 | Walk faster. Does the garden scale with the number of plants? At 2000 words, do frustum culling or LOD matter? Then: do all 3 fixes | done | Walking is about 40% faster. All 3 done. (1) Texture LOD: every plant has a 32×64 sprite in a low sheet, drawn from one SVG per 2048 plants. The nearest ~210 plants (ahead of you first) stream into a fixed GPU pool of 96×192 slots, 24 per batch, via `copyTextureToTexture`. (2) CPU copies of the sheets are dropped after upload. (3) One mesh per bed with a bounding sphere (three frustum-culls it), and beds wholly inside the fog are hidden. At 2000 words, load went from 7.1 s to about 1.0 s on an M4 Pro (1.8 s in software rendering). Texture memory went from about 320 MB (GPU plus CPU) to about 32 MB, and stays the same size whatever the garden size. Uncapped frame rate at 2000 plants on a retina screen at native resolution: about 600 fps (1.7 ms per frame), so frame rate was never the bottleneck. e2e covers a 2000-word garden. |
| 35 | If LOD helps a lot, use higher pixel density by default with only normal and low quality modes | done | Normal (the default) renders at about screen resolution, and textures keep the pixel-art look. Low uses big pixels. If the viewer never chose and the first seconds run under 40 fps, it switches to low once and says why. A choice is remembered per browser. Also fixed: the pixel font's "fi" ligature turned "fingers" into "Angers". |
| 36 | Icon sound on/off toggle, plus a worded option in Settings | done | Speech is the only sound. Sound off means fully silent: nothing is spoken (including what played by itself), speaker buttons are hidden, and listening exercises are left out of new sessions. A speaker icon toggle is in the session bar and the garden HUD, and Settings → Sound has "Sound on / Sound off". The choice is per device (localStorage), not synced. Also: on phones the garden HUD is icon-only and the stats drop the seed count, so nothing wraps. The "fi" ligature fix now applies to every garden element (the font shorthand had reset it). e2e covers it. |
| 27 | Procedurally generated plants seeded by the word, shown when remembering | done | `web/src/ui/plant.tsx`: a seeded genome (7 flower types, petal shape and count, curated colours, leaf shape and arrangement, stem curve, side branches, height). Used in the garden, on every card (its current stage), and as a growing pop when you remember or plant a word. The plant is visible during recall, as agreed (a deliberate, recognisable cue). Unit-tested for determinism. |
| 28 | Record which model wrote each sentence, and offer to improve sentences | done | Sentences store their origin (Perennial AI / own key / local model) and model. Word details show "Written by…" plus "Write new sentences" (cost shown first, undo after). The Words page offers to replace a local model's sentences in bulk. Your own sentences are never replaced. E2E-tested. |
| 15 | UI copy must be plain and unambiguous for non-native English readers (e.g. "Match system") | done | Full pass with Simplified Technical English rules: no contractions or idioms ("Got it" → "I remembered", "awaits", "wrapping up"), one term per concept, literal labels beside the garden metaphor ("known · learning · new"). |

## UX review findings (#9)

| ID | Finding | Status |
|---|---|---|
| F2 | Test & save: raw error JSON, no missing-key check, no busy state | fixed |
| F4 | Onboarding: AI section vanishes on success, no confirmation | fixed |
| F5 | Linking with an unknown code gives no feedback; Generate shown when linking; jargon | fixed |
| F6 | "+ New language" replays the full first-run pitch | fixed |
| F7 | New course defaults to a language you already study; duplicates allowed | fixed |
| F8 | Speaker buttons below 44px touch target | fixed |
| F9 | No undo for grades / "Already know it" | fixed |
| F10 | Forgot gives no acknowledgement | fixed |
| F11 | Double-click on Show lands on "Got it" (grading an unseen answer) | fixed |
| F12 | Retry looks like a duplicate quick check | fixed |
| F13 | ✕ exits without a summary | fixed |
| F14 | Home ignores a partially done session | fixed |
| F15 | Pluralization ("1 words known") | fixed |
| F16 | Garden tooltip shows cryptic "ear"/"pen" | fixed |
| F17 | Seed and suspended glyphs look alike | fixed |
| F18 | Next-review date ambiguous and absolute; "1 reviews" | fixed |
| F19 | Suspend isn't explained | fixed |
| F20 | Delete word: instant, no undo | fixed |
| F21 | Bug: a re-added deleted word stays deleted | fixed |
| F22 | Paste reader calls unstudied words "learning" | fixed |
| F23 | Stale "Added" message | fixed |
| F24 | Enter doesn't submit the "By hand" form | fixed |
| F25 | Bug: keyboard changes to the target-recall slider aren't saved | fixed |
| F26 | No Copy button for the sync code | fixed |
| F27 | Settings doesn't show which AI provider is connected | fixed |

## Observations (not yet requests)

| # | Observation | Status |
|---|---|---|
| O1 | The local dev database for `localhost:5179` was wiped at some point during the session (the old `ankee` database on the same origin survived). No app code deletes databases; the cause is unknown. The browser reports storage as *not persisted*, so it can evict data, and sync is the only backup. | open: consider a "Turn on sync to keep your words safe" hint after the first session. |

## Persona review findings (#21)

B = Birgit (Gen X mom, iPhone, B2 English) · D = Dan (HN, Anki veteran, keyboard) · **both** = found independently by both.

| ID | Finding | From | Status |
|---|---|---|---|
| R1 | Out-of-credits message contradicts itself ("You used all your AI words… You can still add 8."). The request is all-or-nothing, and the cost isn't shown before you tap | **both** | fixed |
| R2 | "AI words" are never explained; the free limit is invisible until you hit it; nobody says the course is free | **both** | fixed |
| R3 | A 7-minute session ends after ~90s with "Well done." because of a hidden per-session cap of 12 new words. Home then offers "Finish today's session". "Practice 5 more" adds 12 more new words each time | **both** | fixed |
| R4 | Scheduler: never-reviewed listening/writing skills get R=0.95. After a break, ~20 new listening cards come before slipping reviews, and writing practically never appears | **both** (verified in code) | fixed |
| R5 | New-word card: "Already know it" vs "Continue" is unclear, and tapping gives no feedback (= #20) | **both** (B explicitly) | fixed |
| R6 | Headline progress overclaims ("about 20% of everyday Finnish" on day 4) with no definition. "Already know it" counts as known with no test | **both** | fixed |
| R7 | Added words in the text picker look unchanged and the counter doesn't update. Picked words are red, with no legend | **both** | fixed |
| R8 | Skipping email/AI on onboarding leads to a dead end: a grey Start button and no button to sign in or add words | B | fixed |
| R9 | First session ends "0 words reviewed" and "You know 0 words … 0%". Demotivating | B | fixed |
| R10 | No export/backup and no account deletion (blocker for D). "Remove course" wipes everything after one browser dialog | **both** | fixed: JSON and CSV export, account deletion, typed confirmation to delete a course. Not yet: .apkg export |
| R11 | Upgrade: USD only, goes straight to Stripe with no confirm, the benefit list is missing on the Add page, the idiom "help keep Perennial independent", no reset date or free alternatives shown | **both** | fixed: confirm step with price, renewal and cancelling; benefits always shown; plain wording; reset date and free options. Currency: set `PRICE_LABEL_*` per deployment (Stripe multi-currency later) |
| R12 | "Perennial AI is very busy" actually means the monthly budget stop; "try again later" could mean weeks | D | fixed |
| R13 | Anki import silently overwrites existing words that share a stable id, and their meanings | D | fixed: existing words are skipped and the preview says how many. Not yet: choosing which field is which |
| R14 | Answer checking: diacritics stripped (ä≠a in Finnish) and a one-letter typo accepted even when it's a case ending. No "count as wrong" | D | fixed |
| R15 | Browser Back leaves the app (no URL routing) | D | fixed |
| R16 | Undo button unlabelled and not recognised | B | fixed |
| R17 | Tab bar covers content on phones (summary line, Pro buttons, Remove course, empty-state hint) | B | fixed |
| R18 | Locale mixing: German dates and numbers inside the English UI ("SONNTAG", "14 Monaten", "2.000") | B | fixed |
| R19 | Ending early with ✕ shows "Session complete" | B | fixed |
| R20 | Self-grading isn't explained on the first quick check; on the listening card the grade labels don't match the prompt; no "can't listen now" | **both** | fixed |
| R21 | Credits bar full at 0 left (reads backwards) | B | fixed |
| R22 | Retention: "remembered (30 days)" has no target or definition; per-word FSRS details (S, D, R, log) not available | D | partly: recall rate shows its target and definition. Not yet: per-word stability, difficulty and review log |
| R23 | Text picker tokens can't be reached by keyboard (span onClick) | D | fixed |
| R24 | Shortcuts missing (Esc, "?", replay audio, override answer, 3 = Good) and not discoverable | D | partly: Esc, ?, R (replay), 3/4 as remembered, and a shortcut list in sessions. Not yet: / for search, Enter on Home |
| R25 | Garden wilts and browns after a break: "guilt, like Duolingo" | B | fixed |
| R26 | Own-key option switches AI off on one tap, before connecting; jargon | B | fixed |
| R27 | Copy polish: stray spaces ("words ."), "forgotten 3 times", no "Saved" feedback, sign-out doesn't say words stay | **both** | fixed |
| R28 | Note toast lingers onto the next card; leaf pop far from the card; Home animation replays on every tab switch | D | fixed |
| R29 | Onboarding: language choice lost on reload; stale "if you skip" line after sign-in | D | fixed |
| R30 | Frequency list fetched 3× in parallel from GitHub; no "your data" privacy explanation; no sync status for signed-in users | D | fixed: list downloaded once, "Your data" explanation, sync status when signed in. Not yet: hosting the word lists ourselves |
