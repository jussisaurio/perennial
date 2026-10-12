# Perennial's voice

A serene garden with quirks. The humour is quiet, often hidden, and it rewards attention. These rules apply to every string in the app and every creature in the gardens. Helpers for rotating lines and rare events: `web/src/core/day.ts` (`daily`, `rareDay`).

1. The garden is funny, not the app. Plants, animals and weather have small opinions; the UI never cracks jokes about itself or the user. Good: 'A bee noticed.' Bad: 'Wow, look at you go, language legend!'
2. Clear sentence first, wink second. The wink can be deleted and the meaning stays. Good: 'Something went wrong. Try again. A leaf fell in the machine.' Bad: 'Oops, the gnomes ate your request!'
3. Short, common words, simple present tense, 2-8 words per sentence. No idioms, phrasal-verb tricks or sarcasm (puns are welcome, see below). Good: 'It has two leaves. It is proud of both.' Bad: 'This sprout is punching above its weight.'
4. Deadpan, not excited. No exclamation marks in English (target-language praise like '¡Muy bien!' is fine). Good: 'Bench: for sitting.' Bad: 'Bench time!! Take a load off!'
5. Never guilt, never count absence, never hurry. Time passing is a story, not a debt. Good: 'Welcome back. A cat took the bench. It is fine.' Bad: 'Your plants missed you for 12 days.'
6. Show before you say. If a picture or behaviour can carry the joke, use no words at all. Good: a sunflower that only shows its face when you stand between it and the sun. Bad: a tooltip that says 'This sunflower is shy, haha.'
7. Rare or rotating, never fixed. A daily-seen line comes from a pool or changes with time, season or progress; a one-off gag must be rare (1 in 25 or less). Good: one sign text per day from a pool of 15. Bad: the same 'Let's grow!' on every session start.
8. Serious where it matters. No jokes in destructive confirms, payment, account deletion, or inside the recall task itself. Good: 'Type delete to confirm.' Bad: 'Are you sure? The plants will cry.'

## Puns are welcome

Puns are fine anywhere they still read as a sensible line to someone who misses the second meaning (for example the sign "No running during your Shift."). Keep the words simple; the pun is a bonus, not the point.

## Checklist for a new line or quirk

- Would it still be nice on day 30? If it is seen daily, it comes from a pool or changes with time, season or progress.
- Can a non-native reader understand it with simple words? No idioms or sarcasm. A pun is fine if the line still makes sense without it.
- Does the meaning survive if you delete the joke?
- Is it outside destructive confirms, account deletion and the recall task itself?
